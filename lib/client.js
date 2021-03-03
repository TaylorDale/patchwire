'use strict';

const getenv = require('./getEnv');
const _ = require('lodash');
const TERMINATING_CHARACTER = '\0';
const DEBUG_MODE = process.env.GM_SERVER_DEBUG === 'true';
const crypto = require('crypto');
const INC_PACKET_SEARCHBOUND = 100;

class Client {

  constructor(socket) {
    this.socket = socket;
    this.dataHandlers = [];
    this.clientId = _.uniqueId();
    this.created = Date.now();
    this.data = {};
    this.tickMode = false;
    this.tickModeQueue = [];
    this.packetCounter = 0;

    socket.on('data', data => {

      const dataAsObject = this.getObjectFromRaw(data);

      if (dataAsObject === false) {
        if (DEBUG_MODE) {
          console.error("Tossing out packet as does not have integrity.");
        }
        return;
      }
      if (DEBUG_MODE) {
        console.info(this.clientId, ' received: ', JSON.stringify(dataAsObject));
      }

      ++this.packetCounter;

      this.dataHandlers.forEach(handler => {
        handler(dataAsObject);
      });
    });

    this.send({
      command: 'connected'
    });

  }

  /**
   * Sends a command. Command string is optional
   * @param {string} command
   * @param {object} data
   */
  send(command, data) {

    if (typeof data === 'undefined') {
      data = command;
    } else {
      data.command = command;
    }

    if (this.tickMode) {

      // If this is a batch send, put all of the commands into the queue.
      if (data.batch) {
        data.commands.forEach(command => {
          this.tickModeQueue.push(command);
        });
      } else {
        this.tickModeQueue.push(data);
      }

    } else {
      this.directSend(data);
    }

  }

  /**
   * Directly writes to the wire
   * @param  {object} command
   */
  directSend(command) {
    if (this.get("destroyed")) return false;

    const header = getenv('PATCH_HEADER');

    // safety check - remove header from content
    const payload = header + JSON.stringify(command).replace(header, '');
    if (DEBUG_MODE) {
      console.info(this.clientId, ' is sending: ', payload);
    }

    this.socket.write(payload);

    return true;
  }

  prepareCommand(command) {
    let dataString = JSON.stringify(command);
    return dataString;
  }

  /**
   * Sends a list of commands together at once
   * @param  {array} commandList
   */
  batchSend(commandList) {
    this.send({
      batch: true,
      commands: commandList
    });
  }

  /**
   * Sets an arbitrary value on this object
   * @param {string} key
   * @param {mixed} value
   */
  set(key, value) {
    this.data[key] = value;
  }

  /**
   * Returns stored data on this object
   * @param  {string} key
   * @return {mixed}
   */
  get(key) {
    return this.data[key];
  }

  /**
   * Registers an event handler on the underlying socket of this client
   * @param  {string} eventName
   * @param  {function} handler
   */
  on(eventName, handler) {
    this.socket.on(eventName, handler);
  }

  /**
   * Registers a handler for when this socket receives data
   * @param  {function} handler
   */
  onData(handler) {
    this.dataHandlers.push(handler);
  }

  /**
   * Sets tick mode on or off.
   * @param {boolean} onOff
   */
  setTickMode(onOff) {
    this.tickMode = onOff;
  }

  /**
   * Sends all stored commands when in tick mode
   */
  tick() {

    if (!this.tickMode) {
      throw new Error('Cannot tick when not in tick mode');
    }

    if (this.tickModeQueue.length !== 0) {
      const command = {
        batch: true,
        commands: this.tickModeQueue
      };

      this.directSend(command);
      this.tickModeQueue = [];
    }
  }

  /**
   * Gets a javascript object from an input buffer containing json
   * @param  {Buffer} data
   * @return {object}
   */
  getObjectFromRaw(data) {
    const rawSocketDataString = data.toString('utf8');
    const terminatingIndex = rawSocketDataString.indexOf(TERMINATING_CHARACTER);
    let trimmedData;
    if (terminatingIndex > -1) {
      trimmedData = rawSocketDataString.substr(0, terminatingIndex);
    } else {
      trimmedData = rawSocketDataString;
    }
    if (trimmedData == null || trimmedData.trim() == '') {
      trimmedData = '{"command": "missingSocketDataString"}';
    }

    // Validate
    let dataSplit = Client.splitCommandAndHash(trimmedData);
    if (this.validateClientCommandIntegrity(dataSplit)) {
      let objectFromData = {};
      try {
        objectFromData = JSON.parse(dataSplit.data);
      } catch(e) {
        return false;
      }
      return objectFromData;
    } else {
      return false;
    }
  }

  validateClientCommandIntegrity(data) {
    let validated = false;
    let modifiedData;

    for (let i=0; i<INC_PACKET_SEARCHBOUND;++i) {
      let checkPacket = this.packetCounter + i;
      let key = '5FR%7Yt!7DgB!69rDXZU8pL7!&iHqDpq@9tX@Zir43JsfymWZg2rTzQ02%pVtgK7LO7n0Znh';
      modifiedData = data.data + key + checkPacket.toString();
      const hasher = crypto.createHash('sha1');
      let serverHash = hasher.update(Buffer.from(modifiedData, 'utf8')).digest('hex');

      if (serverHash == data.hash) {
        validated = true;
        this.packetCounter = checkPacket;
        break;
      }
    }

    if (!validated) {
      console.error('Could not match packet Id for ' + modifiedData);
      this.destroy();
    }

    return validated;
  }

  destroy() {
    if (!this.get("destroyed")) {
      this.set("destroyed", true);
      client.socket.destroy();
    }
  }

  static splitCommandAndHash(data) {
    let hashLength = 40;
    let hash = data.slice(-hashLength);
    let actualData = data.slice(0, -hashLength);

    return {
      hash: hash,
      data: actualData,
    }
  }
}

module.exports = Client;
