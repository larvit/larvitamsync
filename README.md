[![Build Status](https://travis-ci.org/larvit/larvitamsync.svg?branch=master)](https://travis-ci.org/larvit/larvitamsync) [![Dependencies](https://david-dm.org/larvit/larvitamsync.svg)](https://david-dm.org/larvit/larvitamsync.svg)

# larvitamsync

Sync data between minions

## Usage

### Server (data master)

For this to work, larvitamintercom must be configured and up and running!

#### Simple command

```javascript
const	options	= {'exchange': 'test_dataDump'}, // RabbitMQ exchange, must be unique on the queue
	amsync	= require('larvitamsync');

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

new amsync.SyncServer(options, function(err) {
	if (err) throw err;

	console.log('Server active');
});
```

#### Custom http request handler

On each data dump request there is a http request and this can be handled manually

```javascript
const	options	= {'exchange': 'test_dataDump'}, // RabbitMQ exchange, must be unique on the queue
	amsync	= require('larvitamsync');

let	syncServer;

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

new amsync.SyncServer(options, function(err) {
	if (err) throw err;

	console.log('Server active');
});
```

### Client (data slave)

For this to work, larvitamintercom must be configured and up and running!

```javascript
const	options	= {},
	amsync	= require('larvitamsync');

options.exchange	= 'test_dataDump';	// RabbitMQ exchange, must be unique on the queue
options.data	= {'foo': 'bar'};	// Optional data to be sent to the data server

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
const	options	= {'exchange': 'test_dataDump'}, // RabbitMQ exchange, must be unique on the queue
	amsync	= require('larvitamsync');

amsync.mariadb(options, function(err) {
	if (err) throw err;

	console.log('Data synced!');
});
```
