[![Build Status](https://travis-ci.org/larvit/larvitamsync.svg?branch=master)](https://travis-ci.org/larvit/larvitamsync) [![Dependencies](https://david-dm.org/larvit/larvitamsync.svg)](https://david-dm.org/larvit/larvitamsync.svg)

# larvitamsync

Sync data between minions

## Usage

### Server (data master)

#### Simple command

```javascript
const	Intercom	= require('larvitamintercom'),
	options	= {'exchange': 'test_dataDump'}, // RabbitMQ exchange, must be unique on the queue
	amsync	= require('larvitamsync');

options.intercom	= new Intercom('AMQP connection string');

// The stdout from this command will be piped to the data slave
// This will be be the input for the
// https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options
options.dataDumpCmd = {
	'command':	'cat',
	'args':	['/home/myself/dbdump.sql'],
	'options':	{}
};
// or pipe directly from mysqldump:
options.dataDumpCmd = {
	'command':	'mysqldump',
	'args':	['-u', 'root', '-psecret', '--single-transaction', 'dbname', 'table1', 'table2'],
	'options':	{}
};

// You can set range of network ports to be used.
// By not declaring port range a random free port will be used.
options.minPort	= 5000;
options.maxPort	= 5100;

new amsync.SyncServer(options, function(err) {
	if (err) throw err;
	console.log('Server active');
});
```

#### Custom http request handler

On each data dump request there is a http request and this can be handled manually

```javascript
const	Intercom	= require('larvitamintercom'),
	options	= {'exchange': 'test_dataDump'}, // RabbitMQ exchange, must be unique on the queue
	amsync	= require('larvitamsync');

let	syncServer;

options.intercom	= new Intercom('AMQP connection string');

syncServer = new amsync.SyncServer(options, function(err) {
	if (err) throw err;

	console.log('Server active');
});

syncServer.handleHttpReq_original = syncServer.handleHttpReq;

syncServer.handleHttpReq = function(req, res) {

	// Set custom content type
	res.setHeader('Content-Type', 'text/plain');

	// Run different commands depending on request url
	if (req.url === '/') {
		syncServer.options.dataDumpCmd = {'command': 'echo', 'args': ['blergh']};
	} else {
		syncServer.options.dataDumpCmd = {'command': 'echo', 'args': [req.url]};
	}

	// Run the original request handler
	syncServer.handleHttpReq_original(req, res);
}
```

### Client (data slave)

For this to work, larvitamintercom must be configured and up and running!

```javascript
const	Intercom	= require('larvitamintercom'),
	options	= {},
	amsync	= require('larvitamsync');

options.intercom	= new Intercom('AMQP connection string');
options.exchange	= 'test_dataDump';	// RabbitMQ exchange, must be unique on the queue
options.requestOptions	= {'path': '/foobar'};	// Optional extra options to
		// https://www.npmjs.com/package/request that
		// is used to request stuff from the server

new amsync.SyncClient(options, function(err, res) {
	let	syncData	= Buffer.from('');

	if (err) throw err;

	// res is an instance of https://nodejs.org/api/http.html#http_class_http_incomingmessage

	res.on('data', function(chunk) {
		syncData	=	Buffer.concat([syncData, chunk], syncData.length + chunk.length);
	});

	res.on('end', function() {
		console.log('Got sync data:');
		console.log(syncData.toString());
	});

	res.on('error', function(err) {
		throw err;
	});
});
```

#### MariaDB/MySQL

For this to work, both larvitamintercom and larvitdb must be configured and up and running!

```javascript
const	Intercom	= require('larvitamintercom'),
	options	= {'exchange': 'test_dataDump'}, // RabbitMQ exchange, must be unique on the queue
	amsync	= require('larvitamsync');

options.intercom	= new Intercom('AMQP connection string');

amsync.mariadb(options, function(err) {
	if (err) throw err;
	console.log('Data synced!');
});
```
