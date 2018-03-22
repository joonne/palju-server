import React from 'react';


export class IndexPage extends React.Component {

  constructor(props) {
      super(props);
      this.state = {
        data: [],
        burner_on: false,
        current_temp: 0,
        timestamp: 0,
        protocol: null,
      }
      this.sendTestData = this.sendTestData.bind(this);
  }

  componentWillMount() {
    console.log("componentWillMount");

    this.connection = new WebSocket('ws://192.168.10.42:3000', this.state.protocol);

    this.connection.onopen = function () {
      // connection is opened and ready to use
      console.log("Connection open")
    };

    this.connection.onerror = function (error) {
      // an error occurred when sending/receiving data
            console.log(error)

    };

    this.connection.onclose = function() {
      console.log("CLOSE")
    }

    this.connection.onmessage = (message) => {
      console.log('Received: ', message.data);
    };
  }

  componentDidUpdate() {
    console.log("Component did update")
    this.connection.close();
    this.connection = new WebSocket('ws://192.168.10.42:3000', this.state.protocol);

    this.connection.onopen = function () {
      // connection is opened and ready to use
      console.log("Connection open")
    };

    this.connection.onerror = function (error) {
      // an error occurred when sending/receiving data
            console.log(error)

    };

    this.connection.onclose = function() {
      console.log("CLOSE")
    }

    this.connection.onmessage = (message) => {
      console.log('Received: ', message.data);
    };

  }

  componentWillUnmount() {
    console.log("componentWillUnMount")
  }

  render() {
    console.log("render")
    console.log(this.state)
    
    let date = new Date(this.state.timestamp)

    return (
      <div className="home">
        <div className="server-test">
          <p> Send test data: </p>
          <input type='text' onChange={(event) => {console.log(event.target.value); this.setState({protocol: event.target.value})}} placeholder='protocol'/>
          <input type='text' ref={(input) => { this.temp1 = input; }} name='temp1' placeholder='temp1'/>
          <input type='text' ref={(input) => { this.temp2 = input; }} name='temp2' placeholder='temp2'/>
          <button onClick={this.sendTestData}>Send</button>
        </div>
      </div>
    )
  }

  sendTestData() {
    console.log("sendtestdata")
    this.connection.send(JSON.stringify({
      temp_low: this.temp1.value,
      temp_high: this.temp2.value,
      temp_ambient: 10.0,
      warming_phase: 'ON',
      target: 37.8,
      low_limit: 36.5
    }))
  }


}

export default IndexPage;
