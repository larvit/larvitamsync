'use strict';

const	exchangeName	= 'test_dataDump',
	Intercom	= require('larvitamintercom'),
	request	= require('request'),
	assert	= require('assert'),
	amsync	= require(__dirname + '/../index.js'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb'),
	fs	= require('fs'),
	_	= require('lodash');

let	intercomConfigFile;

// Set up winston
log.remove(log.transports.Console);
/**/log.add(log.transports.Console, {
	'level':	'warn',
	'colorize':	true,
	'timestamp':	true,
	'json':	false
});/**/

before(function(done) {
	this.timeout(10000);
	const	tasks	= [];

	// Run DB Setup
	tasks.push(function(cb) {
		let confFile;

		if (process.env.DBCONFFILE === undefined) {
			confFile = __dirname + '/../config/db_test.json';
		} else {
			confFile = process.env.DBCONFFILE;
		}

		log.verbose('DB config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function(err) {
			if (err) {

				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function(err) {
					if (err) throw err;
					log.verbose('DB config: ' + JSON.stringify(require(confFile)));
					db.setup(require(confFile), cb);
				});

				return;
			}

			log.verbose('DB config: ' + JSON.stringify(require(confFile)));
			db.setup(require(confFile), cb);
		});
	});

	// Check for empty db
	tasks.push(function(cb) {
		db.query('SHOW TABLES', function(err, rows) {
			if (err) throw err;

			if (rows.length) {
				throw new Error('Database is not empty. To make a test, you must supply an empty database!');
			}

			cb();
		});
	});

	// Setup intercom
	tasks.push(function(cb) {
		if (process.env.INTCONFFILE === undefined) {
			intercomConfigFile = __dirname + '/../config/amqp_test.json';
		} else {
			intercomConfigFile = process.env.INTCONFFILE;
		}

		log.verbose('Intercom config file: "' + intercomConfigFile + '"');

		// First look for absolute path
		fs.stat(intercomConfigFile, function(err) {
			if (err) {

				// Then look for this string in the config folder
				intercomConfigFile = __dirname + '/../config/' + intercomConfigFile;
				fs.stat(intercomConfigFile, function(err) {
					if (err) throw err;
					log.verbose('Intercom config: ' + JSON.stringify(require(intercomConfigFile)));
					lUtils.instances.intercom = new Intercom(require(intercomConfigFile).default);
					lUtils.instances.intercom.on('ready', cb);
				});

				return;
			}

			log.verbose('Intercom config: ' + JSON.stringify(require(intercomConfigFile)));
			lUtils.instances.intercom = new Intercom(require(intercomConfigFile).default);
			lUtils.instances.intercom.on('ready', cb);
		});
	});

	async.series(tasks, done);
});

describe('Basics', function() {
	it('server', function(done) {
		const	intercom	= new Intercom(require(intercomConfigFile).default), // We need a separate intercom to be able to subscribe again to the exchange
			options	= {'exchange': exchangeName},
			tasks	= [],
			sql	= 'CREATE TABLE `bosse` (`id` int NOT NULL AUTO_INCREMENT PRIMARY KEY, `name` varchar(255) NOT NULL); INSERT INTO bosse (name) VALUES(\'duh\');';

		this.slow(500);

		function handleMsg(message, ack) {
			const	reqOptions	= {};

			ack();

			if (message.action !== 'dumpResponse') {
				return;
			}

			assert(message.endpoints, 'message.endpoints must an array with entries');

			if (message.endpoints[0].family === 'IPv6') {
				reqOptions.uri = 'http://[' + message.endpoints[0].host + ']';
			} else {
				reqOptions.uri = 'http://' + message.endpoints[0].host;
			}

			reqOptions.uri	+= ':' + message.endpoints[0].port;
			reqOptions.headers	= {'token': message.endpoints[0].token};

			request(reqOptions, function(err, res, body) {
				if (err) throw err;

				assert.deepEqual(_.trim(body), _.trim(sql));
				done();
			});
		}

		// Wait for the intercom to come online
		tasks.push(function(cb) {
			intercom.on('ready', cb);
		});

		// Start server
		tasks.push(function(cb) {
			options.dataDumpCmd = {
				'command':	'echo',
				'args':	[sql]
			};

			options['Content-Type'] = 'application/sql';

			new amsync.SyncServer(options, cb);
		});

		// Subscribe to happenings on the queue on our new intercom
		tasks.push(function(cb) {
			intercom.subscribe({'exchange': exchangeName}, handleMsg, cb);
		});

		// Send the request to the queue
		tasks.push(function(cb) {
			intercom.send({'action': 'reqestDump'}, {'exchange': exchangeName}, cb);
		});

		async.series(tasks, function(err) {
			if (err) throw err;
		});
	});

//	it('client', function(done) {
//
//	});
});

after(function(done) {
	db.removeAllTables(done);
});
