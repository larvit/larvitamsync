[![Build Status](https://travis-ci.org/larvit/larvitamsync.svg?branch=master)](https://travis-ci.org/larvit/larvitamsync) [![Dependencies](https://david-dm.org/larvit/larvitamsync.svg)](https://david-dm.org/larvit/larvitamsync.svg)

# larvitamsync

Sync data between minions

## Usage

### Server (data master)

For this to work, larvitamintercom must be configured and up and running!

```javascript
const	options	= {'exchange': 'test_dataDump'}, // RabbitMQ exchange, must be unique on the queue
	amsync	= require('larvitamsync');

let	syncServer;

// The stdout from this command will be piped to the data slave
// This will be be the input for the https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options
options.dataDumpCmd = {'command': 'cat', 'args': ['/home/myself/dbdump.sql'], 'options': {}};
// or
options.dataDumpCmd = {'command': 'mysqldump', 'args': ['-u', 'root', '-psecret', '--single-transaction', 'dbname', 'table1', ,'table2'], 'options': {}};
// or something else

// Optional Content-Type header can be set like this:
options['Content-Type'] = 'application/sql';

// Returns https://nodejs.org/api/http.html#http_class_http_server
syncServer = new amsync.SyncServer(options, function(err) {
	if (err) throw err;

	console.log('Server active');
});
```

### MariaDB/MySQL Client (data slave)

For this to work, both larvitamintercom and larvitdb must be configured and up and running!

```javascript
const	options	= {'exchange': 'test_dataDump'}, // RabbitMQ exchange, must be unique on the queue
	amsync	= require('larvitamsync');

amsync.mariadb.reqSync(options, function(err) {
	if (err) throw err;

	console.log('Data synced!');
});
```
