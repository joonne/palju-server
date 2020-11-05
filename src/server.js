/* eslint no-console: "off" */

import path from 'path';
import { Server } from 'http';
import Express from 'express';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter as Router } from 'react-router-dom';
import { App } from './components/App';

import WebSocket from 'ws';
import url from 'url';

import loki from 'lokijs'
import lfsa  from 'lokijs/src/loki-fs-structured-adapter'

const app = new Express();
const server = new Server(app);
const wss = new WebSocket.Server({ server });

// use ejs templates
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// define the folder that will be used for static assets
app.use(Express.static(path.join(__dirname, 'static')));

const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  user: process.env.DATABASE_USER || 'postgres',
  password: 'mysecretpassword',
  database: 'palju',
  ssl: process.env.NODE_ENV === 'production'
});

const getTest = (timestamp) => JSON.stringify({
  temp_low: parseFloat('36.5'),
  temp_high: parseFloat('40.2'),
  temp_ambient: parseFloat('16.3'),
  warming_phase: 'ON',
  target: parseFloat('45.3'),
  low_limit: parseFloat('33.3'),
  timestamp,
  get estimation() { return ((parseFloat(this.target) - parseFloat(this.temp_high)) / 10 * 60 * 60) + Math.floor(new Date() / 1000); }
});

(async () => {
  try {
    const client = await pool.connect();
    await client.query('DROP TABLE instance;');
    await client.query(`CREATE TABLE IF NOT EXISTS instance (id SERIAL PRIMARY KEY, timestamp integer, values jsonb DEFAULT '[{}]');`);
    await client.query(`DELETE FROM instance;`);
    await client.query(`
      INSERT INTO instance (values)
      VALUES ('[${getTest(1)}, ${getTest(2)}, ${getTest(3)}]')
    `);
  } catch (error) {
    console.error(error.stack);
    process.exit(1);
  }
})();

const SIX_HOURS_IN_SECONDS = 60 * 60 * 6;

// Returns the heating instances as an array of hashes containing the start and end timestamps
// [{start: unix_timestamp, end: unix_timestamp}, ...]
app.get('/instances', async (req, res) => {
  const client = await pool.connect();
  const result = await client.query(`SELECT values FROM instance;`);
  const records = result.rows || [];

  return res.json(records);

  const instances = [];
  let instance = [];

  records
    .map(r => r.timestamp)
    .forEach((currentValue) => {
      if (instance.length > 0) {
        if ((currentValue - SIX_HOURS_IN_SECONDS) < instance[instance.length - 1]) { // Less than 6 hours from last value
          instance.push(currentValue);
        } else { // More than 6 hour, consider as a new instance.
          instances.push(instance);
          instance = [currentValue];
        }
      } else {
        instance.push(currentValue);
      }
    });

  instances.push(instance);

  // Remove instances with less than 100 datapoints to remove some test data.
  const retval = instances
    .filter(value => value.length > 100)
    .map((value) => ({ start: value.shift(), end: value.pop() }));

  return res.status(200).json(retval);
});

app.get('/instances/:after/:before', async (req, res) => {
  const { after, before } = req.params;
  const client = await pool.connect();
  const records = await client.query(`
    SELECT values
    FROM instance i
    CROSS JOIN LATERAL jsonb_array_elements ( values ) as j
    WHERE (j->>'timestamp')::int BETWEEN ${after} AND ${before}
    ORDER BY j->>'timestamp' ASC
  `);

  return res.status(200).json(records);
});

const port = process.env.PORT || 3000;
const env = process.env.NODE_ENV || 'production';
server.listen(port, (err) => {
  if (err) {
    return console.error(err);
  }

  return console.info(`Server running on http://localhost:${port} [${env}]`);
});

wss.on('connection', async (ws, req) => {
  console.log("Connected with: " + req.headers['sec-websocket-protocol']);
  ws.clientType = req.headers['sec-websocket-protocol'];

  ws.isAlive = true;
  ws.on('pong', function() {
    this.isAlive = true;
  });

  const client = await pool.connect();

  // Send the latest record on connection
  const timeHourAgo = Math.floor(new Date() / 1000) - (60 * 60);
  const records = await client.query(`
    SELECT values
    FROM instance
    WHERE (values->>'timestamp')::int >= ${timeHourAgo}
    ORDER BY values->>'timestamp' ASC
  `);
  const latestRecord = records.length > 0 ? records.pop() : {};
  ws.send(JSON.stringify(latestRecord));

  ws.on('message', async (message) => {
    console.log(`received: ${message}`);

    let data;

    try {
      data = JSON.parse(message);
    } catch (error) {
      console.error(error.stack);
      data = {}
    }

    if (data.temp_low !== null) {
      const timeNow = Math.floor(new Date() / 1000); // Unix timestamp

      const values = JSON.stringify({
        temp_low: parseFloat(data.temp_low), 
        temp_high: parseFloat(data.temp_high),
        temp_ambient: parseFloat(data.temp_ambient),
        warming_phase: data.warming_phase,
        target: parseFloat(data.target),
        low_limit: parseFloat(data.low_limit),
        timestamp: timeNow, 
        estimation: ((parseFloat(data.target) - parseFloat(data.temp_high)) / 10 * 60 * 60) + timeNow // 10 degrees in a hour
      });

      if (ws.clientType !== 'mobile') {
        await client.query(`
          INSERT INTO instance (values)
          VALUES ('${values}')
        `);
      }

      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client !== ws) {
          if (ws.clientType === 'mobile' || client.clientType === 'mobile' ) {
            client.send(values);
          }
        }
      });
    } else if (data.from !== null) {
      const records = await client.query(`
         SELECT values 
         FROM instance
         ORDER BY values->'timestamp' ASC
         LIMIT 50;
      `);

      return ws.send(JSON.stringify(records.rows));
    }
  });
});


// Ping connections every 30 seconds to keep them alive
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false){
     console.log("KILLING WEBSOCKET CONNECTION");
     return ws.terminate();
   }

    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 10000);
