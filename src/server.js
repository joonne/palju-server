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


var adapter = new lfsa();
var db = new loki('./data/palju.db',
  {
    autoload: true,
    autoloadCallback : loadHandler,
    autosave: true, 
    autosaveInterval: 10000, // 10 seconds
    adapter: adapter,
    verbose: true
  }); 

function loadHandler() {
  console.log("Load handler")
  // if database did not exist it will be empty so I will intitialize here
  var coll = db.getCollection('palju');
  if (coll === null) {
    coll = db.addCollection('palju');
  }
}


// Returns the heating instances as an array of hashes containing the start and end timestamps
// [{start: unix_timestamp, end: unix_timestamp}, ...]
app.get('/instances', (req, res) => {
  let markup = '';
  let status = 200;
  let paljuData = db.getCollection("palju");

  // Get all data
  let records = paljuData.chain().find({}).simplesort('timestamp').data();
  let instances = [];
  let instance = [];

  // Figure out the instances
  records.map(r => r.timestamp).forEach( (currentValue, index, values) => {
    if (instance.length > 0){
      if (currentValue - (60*60*6) < instance[instance.length - 1]){ // Less than 6 hours from last value
        instance.push(currentValue);
      } else { // More than 6 hour, consider as a new instance.
        instances.push(instance);
        instance = [currentValue]
      }
    } else {
      instance.push(currentValue);
    } 
  });
  instances.push(instance);
  // Remove instances with less than 100 datapoints to remove some test data. 
  const retval = instances.filter(value => value.length > 100).map((value) => { return {start: value.shift(), end: value.pop()}})

  res.setHeader('Content-Type', 'application/json');
  res.status(status)
  res.send(JSON.stringify(retval));
});


// Returns the recorded data between the given timestamps
app.get('/instances/:after/:before', (req, res) => {
  let markup = '';
  let status = 200;
  let paljuData = db.getCollection("palju");
  let records = paljuData.chain().find({'timestamp': {'$between': [req.params['after'], req.params['before']]}}).simplesort('timestamp').data();

  res.setHeader('Content-Type', 'application/json');
  res.status(status)
  res.send(JSON.stringify(stripResultsMetadata(records)));
});

// start the server
const port = process.env.PORT || 3000;
const env = process.env.NODE_ENV || 'production';
server.listen(port, (err) => {
  if (err) {
    return console.error(err);
  }

  

  return console.info(
    `
      Server running on http://localhost:${port} [${env}]
    `);
});


wss.on('connection', (ws, req) => {

  console.log("Get paljuData")
  let paljuData = db.getCollection("palju");

  console.log("Connected with: " + req.headers['sec-websocket-protocol'])
  ws.clientType = req.headers['sec-websocket-protocol'];

  ws.isAlive = true;
  ws.on('pong', function(){
    this.isAlive = true;
  });

  const location = url.parse(req.url, true);

  // Send the latest record on connection
  let timeHourAgo = Math.floor(new Date() / 1000) - (60 * 60); // Unix timestamp
  let records = paljuData.chain().find({'timestamp': {'$gt': timeHourAgo}}).simplesort('timestamp').data();
  let latestRecord = records.length > 0 ? records.pop() : {}
  ws.send(JSON.stringify(stripResultsMetadata(latestRecord)));

  ws.on('message', function incoming(message) {
    console.log('received: %s', message);

    // Parse data
    let data = JSON.parse(message)
    console.log(data.temp_low != null)
    if (data.temp_low != null) {
      let timeNow = Math.floor(new Date() / 1000); // Unix timestamp

      const values = {
        temp_low: parseFloat(data.temp_low), 
        temp_high: parseFloat(data.temp_high),
        temp_ambient: parseFloat(data.temp_ambient),
        warming_phase: data.warming_phase,
        target: parseFloat(data.target),
        low_limit: parseFloat(data.low_limit),
        timestamp: timeNow, 
        estimation: ((parseFloat(data.target) - parseFloat(data.temp_high)) / 10 * 60 * 60) + timeNow // 10 degrees in a hour
      }

      if (ws.clientType != 'mobile'){
        paljuData.insert(values);
      }
      
      console.log("Sending to all clients")
      wss.clients.forEach(function each(client) {
        console.log("Should we send to client:" + client.clientType)
        
        if ( client.readyState === WebSocket.OPEN && client !== ws /* to exclude the sender*/ ) {
          console.log("Not self & is open")
          // Sender is mobile-app, or receiver is mobile app
          if (ws.clientType == 'mobile' || client.clientType == 'mobile' ) {
            console.log("Client is mobile or receiver is mobile")
            console.log("Sending to:" + client.clientType)

            client.send(JSON.stringify(stripResultsMetadata(values)));
          }
        }
      });
    } else if (data.from != null) {
      // Send the latest 50
    //data.find({}).sort({timestamp: 1}).limit(50).exec( (err, docs) => {
    //    ws.send(JSON.stringify(docs))
    //  })
    }
  });

});


// Ping connections every 30 seconds to keep them alive
setInterval(() => {
    wss.clients.forEach((ws: ExtWebSocket) => {
        
        if (ws.isAlive == false){
         console.log("KILLING WEBSOCKET CONNECTION")
         return ws.terminate();
       }
        
        ws.isAlive = false;
        ws.ping(() => {});
    });
}, 10000);


// Function to remove the meta data created by the lokijs from the responses
export function stripResultsMetadata( results ) {

  const isArray = Array.isArray(results); // Check whether array was provided
  
  if(!isArray) results = [results]; // Convert to array

  const records = [];
  
	for (var idx = 0; idx < results.length; idx++) {
		const loki_rec = results[ idx ]
		const clean_rec = Object.assign({}, loki_rec)
		delete clean_rec['meta']
		delete clean_rec['$loki']
		records.push( clean_rec )
	}
	return isArray ? records : records.pop(); // Convert to initial
}