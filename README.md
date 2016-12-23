[![Build Status](https://travis-ci.org/larvit/larvitamsync.svg?branch=master)](https://travis-ci.org/larvit/larvitamsync) [![Dependencies](https://david-dm.org/larvit/larvitamsync.svg)](https://david-dm.org/larvit/larvitamsync.svg)

# larvitamsync

Sync data between minions

## Usage

### Server (data master)

For this to work, larvitamintercom must be configured and up and running!

```javascript
const	options	= {'exchange': 'test_dataDump'}, // RabbitMQ exchange, must be unique on the queue
	amsync	= require('larvitamsync');

// The stdout from this command will be piped to the data slave
options.dataDumpCmd = 'cat /home/myself/dbdump.sql';
// or
options.dataDumpCmd = 'mysqldump -u root -psecret --single-transaction dbname table1 table2';
// or something else

amsync.mariadb.reqSync(options, function(err) {
	if (err) throw err;

	console.log('Data synced!');
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
