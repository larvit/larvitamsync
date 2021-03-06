'use strict';

const	Intercom	= require('larvitamintercom'),
	request	= require('request'),
	assert	= require('assert'),
	LUtils	= require('larvitutils'),
	lUtils	= new LUtils(),
	amsync	= require(__dirname + '/../index.js'),
	async	= require('async'),
	http	= require('http'),
	nics	= require('os').networkInterfaces(),
	log	= new lUtils.Log('error'),
	sql	= 'CREATE TABLE `bosse` (`id` int NOT NULL AUTO_INCREMENT PRIMARY KEY, `name` varchar(255) NOT NULL); INSERT INTO bosse (name) VALUES(\'duh\');',
	db	= require('larvitdb'),
	fs	= require('fs'),
	_	= require('lodash');

let	intercomConfigFile,
	intercom;

process.on('warning', (warning) => {
	console.log(warning.name);
	console.log(warning.message);
	console.log(warning.stack);
});

before(function (done) {
	this.timeout(10000);
	const	tasks	= [];

	// Run DB Setup
	tasks.push(function (cb) {
		let confFile;

		if (process.env.DBCONFFILE === undefined) {
			confFile	= __dirname + '/../config/db_test.json';
		} else {
			confFile	= process.env.DBCONFFILE;
		}

		log.verbose('DB config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function (err) {
			let	dbConf;

			if (err) {

				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function (err) {
					if (err) throw err;

					dbConf	= require(confFile);
					dbConf.log	= log;

					log.verbose('DB config: ' + JSON.stringify(dbConf));
					db.setup(dbConf, cb);
				});

				return;
			}

			dbConf	= require(confFile);
			dbConf.log	= log;

			log.verbose('DB config: ' + JSON.stringify(dbConf));
			db.setup(dbConf, cb);
		});
	});

	// Check for empty db
	tasks.push(function (cb) {
		db.query('SHOW TABLES', function (err, rows) {
			if (err) throw err;

			if (rows.length) {
				throw new Error('Database is not empty. To make a test, you must supply an empty database!');
			}

			cb();
		});
	});

	// Get intercom config file and start intercom
	tasks.push(function (cb) {
		if (process.env.INTCONFFILE === undefined) {
			intercomConfigFile	= __dirname + '/../config/amqp_test.json';
		} else {
			intercomConfigFile	= process.env.INTCONFFILE;
		}

		log.verbose('Intercom config file: "' + intercomConfigFile + '"');

		// First look for absolute path
		fs.stat(intercomConfigFile, function (err) {
			let	intercomConf;

			if (err) {

				// Then look for this string in the config folder
				intercomConfigFile = __dirname + '/../config/' + intercomConfigFile;
				fs.stat(intercomConfigFile, function (err) {
					if (err) throw err;

					intercomConf	= {'conStr': require(intercomConfigFile)};
					intercomConf.log	= log;

					log.verbose('Intercom config: ' + JSON.stringify(intercomConf));
					intercom	= new Intercom(intercomConf);
					intercom.on('ready', cb);
				});

				return;
			}

			intercomConf	= {'conStr': require(intercomConfigFile)};
			intercomConf.log	= log;

			log.verbose('Intercom config: ' + JSON.stringify(intercomConf));
			intercom	= new Intercom(intercomConf);
			intercom.on('ready', cb);
		});
	});

	async.series(tasks, done);
});

describe('Basics', function () {
	it('server', function (done) {
		const	exchangeName	= 'test_dataDump_server',
			intercom1	= new Intercom({'conStr': require(intercomConfigFile), 'log': log}),
			intercom2	= new Intercom({'conStr': require(intercomConfigFile), 'log': log}),
			options	= {'exchange': exchangeName},
			tasks	= [];

		let	msgHandled	= false;

		this.slow(500);

		function handleMsg(message, ack) {
			const	reqOptions	= {};

			ack();

			if (message.action !== 'dumpResponse' || msgHandled !== false) {
				return;
			}

			msgHandled = true;

			assert(message.endpoints, 'message.endpoints must an array with entries');

			if (message.endpoints[0].family === 'IPv6') {
				reqOptions.uri	= 'http://[' + message.endpoints[0].host + ']';
			} else {
				reqOptions.uri	= 'http://' + message.endpoints[0].host;
			}

			reqOptions.uri	+= ':' + message.endpoints[0].port;
			reqOptions.headers	= {'token': message.endpoints[0].token};

			request(reqOptions, function (err, res, body) {
				if (err) throw err;

				assert.deepEqual(_.trim(body), _.trim(sql));
				done();
			});
		}

		// Start server
		tasks.push(function (cb) {
			options.dataDumpCmd = {
				'command':	'echo',
				'args':	[sql]
			};

			options['Content-Type']	= 'application/sql';
			options.intercom	= intercom2;
			options.log	= log;

			new amsync.SyncServer(options, cb);
		});

		// Subscribe to happenings on the queue on intercom1
		tasks.push(function (cb) {
			intercom1.subscribe({'exchange': exchangeName}, handleMsg, cb);
		});

		// Send the request to the queue
		tasks.push(function (cb) {
			intercom1.send({'action': 'requestDump'}, {'exchange': exchangeName}, cb);
		});

		async.series(tasks, function (err) {
			if (err) throw err;
		});
	});

	it('client', function (done) {
		const	exchangeName	= 'test_dataDump_client',
			msgContent	= 'wlüpp!',
			intercom1	= new Intercom({'conStr': require(intercomConfigFile), 'log': log}),
			intercom2	= new Intercom({'conStr': require(intercomConfigFile), 'log': log}),
			token	= 'fjärtkorv',
			tasks	= [];

		this.slow(500);

		function handleIncMsg(message, ack) {
			ack();

			if (message.action !== 'requestDump') {
				return;
			}

			let	server;

			server = http.createServer(function (req, res) {
				assert.deepEqual(req.headers.token, token);
				res.writeHead(200, {'Content-Type': 'plain/text'});
				res.end(msgContent);
				server.close();
			});
			server.listen(0);
			server.on('error', function (err) {
				throw err;
			});

			server.on('listening', function () {
				const	servedPort	= server.address().port,
					message	= {'action': 'dumpResponse', 'endpoints': []};

				for (const nic of Object.keys(nics)) {
					for (let i = 0; nics[nic][i] !== undefined; i ++) {
						const	nicAddress	= nics[nic][i];

						if (nicAddress.internal === false) {
							message.endpoints.push({
								'family':	nicAddress.family,
								'host':	nicAddress.address,
								'port':	servedPort,
								'token':	token
							});
						}
					}
				}

				intercom1.send(message, {'exchange': exchangeName});
			});
		}

		// Listen to the queue for dump requests
		tasks.push(function (cb) {
			intercom1.subscribe({'exchange': exchangeName}, handleIncMsg, cb);
		});

		// Start client
		tasks.push(function (cb) {
			const	options	= {'exchange': exchangeName, 'intercom': intercom2, 'log': log};

			new amsync.SyncClient(options, function (err, res) {
				let	syncData	= Buffer.from('');

				if (err) return cb(err);

				res.on('data', function (chunk) {
					syncData	=	Buffer.concat([syncData, chunk], syncData.length + chunk.length);
				});

				res.on('end', function () {
					assert.deepEqual(syncData.toString(), msgContent);
					done();
				});

				res.on('error', cb);
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
		});
	});

	it('server with port range', function (done) {
		const	exchangeName	= 'test_dataDump_server2',
			intercom1	= new Intercom({'conStr': require(intercomConfigFile), 'log': log}),
			intercom2	= new Intercom({'conStr': require(intercomConfigFile), 'log': log}),
			options	= {'exchange': exchangeName},
			tasks	= [];

		let	msgHandled	= false;

		this.slow(500);

		function handleMsg(message, ack) {
			const	reqOptions	= {};

			ack();

			if (message.action !== 'dumpResponse' || msgHandled !== false) {
				return;
			}

			msgHandled = true;

			assert(message.endpoints, 'message.endpoints must an array with entries');

			if (message.endpoints[0].family === 'IPv6') {
				reqOptions.uri = 'http://[' + message.endpoints[0].host + ']';
			} else {
				reqOptions.uri = 'http://' + message.endpoints[0].host;
			}

			assert.strictEqual(message.endpoints[0].port >= options.minPort, true);
			assert.strictEqual(message.endpoints[0].port <= options.maxPort, true);

			reqOptions.uri	+= ':' + message.endpoints[0].port;

			reqOptions.headers	= {'token': message.endpoints[0].token};

			request(reqOptions, function (err, res, body) {
				if (err) throw err;

				assert.deepEqual(_.trim(body), _.trim(sql));
				done();
			});
		}

		// Start server
		tasks.push(function (cb) {
			options.dataDumpCmd = {
				'command':	'echo',
				'args':	[sql]
			};

			options['Content-Type']	= 'application/sql';
			options.intercom	= intercom2;
			options.minPort	= 9000;
			options.maxPort	= 9100;
			options.log	= log;

			new amsync.SyncServer(options, cb);
		});

		// Subscribe to happenings on the queue on intercom1
		tasks.push(function (cb) {
			intercom1.subscribe({'exchange': exchangeName}, handleMsg, cb);
		});

		// Send the request to the queue
		tasks.push(function (cb) {
			intercom1.send({'action': 'requestDump'}, {'exchange': exchangeName}, cb);
		});

		async.series(tasks, function (err) {
			if (err) throw err;
		});
	});

	it('server with specific host', function (done) {
		const	exchangeName	= 'test_dataDump_server3',
			intercom1	= new Intercom(require(intercomConfigFile)),
			intercom2	= new Intercom(require(intercomConfigFile)),
			options	= {'exchange': exchangeName, 'log': log},
			tasks	= [];

		let	msgHandled	= false;

		this.slow(500);

		function handleMsg(message, ack) {
			ack();

			if (message.action !== 'dumpResponse' || msgHandled !== false) {
				return;
			}

			msgHandled = true;

			assert(message.endpoints, 'message.endpoints must an array with entries');

			assert.strictEqual(message.endpoints[0].host, 'untz.com');
			done();
		}

		// Start server
		tasks.push(function (cb) {
			options.dataDumpCmd = {
				'command':	'echo',
				'args':	[sql]
			};

			options['Content-Type']	= 'application/sql';
			options.intercom	= intercom2;
			options.host	= 'untz.com';

			new amsync.SyncServer(options, cb);
		});

		// Subscribe to happenings on the queue on intercom1
		tasks.push(function (cb) {
			intercom1.subscribe({'exchange': exchangeName}, handleMsg, cb);
		});

		// Send the request to the queue
		tasks.push(function (cb) {
			intercom1.send({'action': 'requestDump'}, {'exchange': exchangeName}, cb);
		});

		async.series(tasks, function (err) {
			if (err) throw err;
		});
	});

	it('single server with short portrange and lots of clients', function (done) {
		const	exchangeName	= 'test_dataDump_server4',
			serverIntercom	= new Intercom({'conStr': require(intercomConfigFile), 'log': log}),
			clientIntercom	= new Intercom({'conStr': require(intercomConfigFile), 'log': log}),
			options	= {'exchange': exchangeName, 'log': log},
			tasks	= [];

		let recievedData	= 0;

		this.slow(500);
		this.timeout(5000);

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

			assert.strictEqual(message.endpoints[0].port >= options.minPort, true);
			assert.strictEqual(message.endpoints[0].port <= options.maxPort, true);

			reqOptions.uri	+= ':' + message.endpoints[0].port;

			reqOptions.headers	= {'token': message.endpoints[0].token};

			request(reqOptions, function (err, res, body) {
				if (err) throw err;

				assert.deepEqual(_.trim(body), _.trim(sql));
				recievedData ++;
				// Check if we recieved data 25 times.
				if (recievedData === 25) done();
			});
		}

		// Start server and listen on only 3 ports
		tasks.push(function (cb) {
			options.dataDumpCmd = {
				'command':	'echo',
				'args':	[sql]
			};

			options['Content-Type']	= 'application/sql';
			options.intercom	= serverIntercom;
			options.minPort	= 8100;
			options.maxPort	= 8102;
			options.log	= log;

			new amsync.SyncServer(options, cb);
		});

		// Subscribe to exchange
		tasks.push(function (cb) {
			clientIntercom.subscribe({'exchange': exchangeName}, handleMsg, cb);
		});

		// Send a message on several messages
		for (let i = 0; i <= 24; i ++) {
			tasks.push(function (cb) {
				clientIntercom.send({'action': 'requestDump'}, {'exchange': exchangeName}, cb);
			});
		}

		async.series(tasks, function (err) {
			if (err) throw err;
		});
	});


	it('multiple servers with short portrange and lots of clients', function (done) {
		const	serverIntercomConf	= {'conStr': require(intercomConfigFile), 'log': log},
			serverIntercom1	= new Intercom(serverIntercomConf),
			serverIntercom2	= new Intercom(serverIntercomConf),
			serverIntercom3	= new Intercom(serverIntercomConf),
			serverIntercom4	= new Intercom(serverIntercomConf),
			serverIntercom5	= new Intercom(serverIntercomConf),
			clientIntercom1	= new Intercom(serverIntercomConf),
			clientIntercom2	= new Intercom(serverIntercomConf),
			clientIntercom3	= new Intercom(serverIntercomConf),
			clientIntercom4	= new Intercom(serverIntercomConf),
			clientIntercom5	= new Intercom(serverIntercomConf),
			tasks	= [];

		let recievedData	= 0;

		this.slow(2000);
		this.timeout(8000);

		function handleMsg(message, ack) {
			const	reqOptions	= {};

			ack();

			if (message.action !== 'dumpResponse') return;

			assert(message.endpoints, 'message.endpoints must an array with entries');

			if (message.endpoints[0].family === 'IPv6') {
				reqOptions.uri = 'http://[' + message.endpoints[0].host + ']';
			} else {
				reqOptions.uri = 'http://' + message.endpoints[0].host;
			}

			assert.strictEqual(message.endpoints[0].port >= 8100, true);
			assert.strictEqual(message.endpoints[0].port <= 8104, true);

			reqOptions.uri	+= ':' + message.endpoints[0].port;

			reqOptions.headers	= {'token': message.endpoints[0].token};

			request(reqOptions, function (err, res, body) {
				if (err) throw err;

				assert.deepEqual(_.trim(body), _.trim(sql));
				recievedData ++;
				// Check if we recieved data 125 times.
				if (recievedData === 125) done();
			});
		}

		// Start server1 and listen on 5 ports
		tasks.push(function (cb) {
			const	options = {
				'minPort':	8100,
				'maxPort':	8104,
				'Content-Type':	'application/sql',
				'intercom':	serverIntercom1,
				'exchange':	'test_dataDump_server5',
				'log':	log,
				'dataDumpCmd': {
					'command':	'echo',
					'args':	[sql]
				}
			};

			new amsync.SyncServer(options, cb);
		});

		// Start server2 and listen on 5 ports
		tasks.push(function (cb) {
			const	options = {
				'minPort':	8100,
				'maxPort':	8104,
				'Content-Type':	'application/sql',
				'intercom':	serverIntercom2,
				'exchange':	'test_dataDump_server6',
				'log':	log,
				'dataDumpCmd': {
					'command':	'echo',
					'args':	[sql]
				}
			};

			new amsync.SyncServer(options, cb);
		});

		// Start server3 and listen on 5 ports
		tasks.push(function (cb) {
			const	options = {
				'minPort':	8100,
				'maxPort':	8104,
				'Content-Type':	'application/sql',
				'intercom':	serverIntercom3,
				'exchange':	'test_dataDump_server7',
				'log':	log,
				'dataDumpCmd': {
					'command':	'echo',
					'args':	[sql]
				}
			};

			new amsync.SyncServer(options, cb);
		});

		// Start server4 and listen on 5 ports
		tasks.push(function (cb) {
			const	options = {
				'minPort':	8100,
				'maxPort':	8104,
				'Content-Type':	'application/sql',
				'intercom':	serverIntercom4,
				'exchange':	'test_dataDump_server8',
				'log':	log,
				'dataDumpCmd': {
					'command':	'echo',
					'args':	[sql]
				}
			};

			new amsync.SyncServer(options, cb);
		});

		// Start server5 and listen on 5 ports
		tasks.push(function (cb) {
			const	options = {
				'minPort':	8100,
				'maxPort':	8104,
				'Content-Type':	'application/sql',
				'intercom':	serverIntercom5,
				'exchange':	'test_dataDump_server9',
				'log':	log,
				'dataDumpCmd': {
					'command':	'echo',
					'args':	[sql]
				}
			};

			new amsync.SyncServer(options, cb);
		});

		// Start subscription on clientIntercom1 listening to test_dataDump_server5
		tasks.push(function (cb) {
			clientIntercom1.subscribe({'exchange': 'test_dataDump_server5'}, handleMsg, cb);
		});

		// Send a several messages on clientIntercom1 and test_dataDump_server5
		for (let i = 0; i <= 24; i ++) {
			tasks.push(function (cb) {
				clientIntercom1.send({'action': 'requestDump'}, {'exchange': 'test_dataDump_server5'}, cb);
			});
		}

		// Start subscription on clientIntercom2 listening to test_dataDump_server6
		tasks.push(function (cb) {
			clientIntercom2.subscribe({'exchange': 'test_dataDump_server6'}, handleMsg, cb);
		});

		// Send a several messages on clientIntercom2 and test_dataDump_server6
		for (let i = 0; i <= 24; i ++) {
			tasks.push(function (cb) {
				clientIntercom2.send({'action': 'requestDump'}, {'exchange': 'test_dataDump_server6'}, cb);
			});
		}

		// Start subscription on clientIntercom3 listening to test_dataDump_server7
		tasks.push(function (cb) {
			clientIntercom3.subscribe({'exchange': 'test_dataDump_server7'}, handleMsg, cb);
		});

		// Send a several messages on clientIntercom3 and test_dataDump_server7
		for (let i = 0; i <= 24; i ++) {
			tasks.push(function (cb) {
				clientIntercom3.send({'action': 'requestDump'}, {'exchange': 'test_dataDump_server7'}, cb);
			});
		}

		// Start subscription on clientIntercom4 listening to test_dataDump_server8
		tasks.push(function (cb) {
			clientIntercom4.subscribe({'exchange': 'test_dataDump_server8'}, handleMsg, cb);
		});

		// Send a several messages on clientIntercom4 and test_dataDump_server8
		for (let i = 0; i <= 24; i ++) {
			tasks.push(function (cb) {
				clientIntercom4.send({'action': 'requestDump'}, {'exchange': 'test_dataDump_server8'}, cb);
			});
		}

		// Start subscription on clientIntercom5 listening to test_dataDump_server9
		tasks.push(function (cb) {
			clientIntercom5.subscribe({'exchange': 'test_dataDump_server9'}, handleMsg, cb);
		});

		// Send a several messages on clientIntercom5 and test_dataDump_server9
		for (let i = 0; i <= 24; i ++) {
			tasks.push(function (cb) {
				clientIntercom5.send({'action': 'requestDump'}, {'exchange': 'test_dataDump_server9'}, cb);
			});
		}

		async.series(tasks, function (err) {
			if (err) throw err;
		});
	});
});

describe('Database', function () {
	it('should sync MariaDB/MySQL stuff', function (done) {
		const	exchangeName	= 'test_dataDump_mariadb',
			intercom1	= new Intercom({'conStr': require(intercomConfigFile), 'log': log}),
			intercom2	= new Intercom({'conStr': require(intercomConfigFile), 'log': log}),
			tasks	= [];

		this.slow(500);

		// Start server
		tasks.push(function (cb) {
			const	options	= {'exchange': exchangeName};

			options.dataDumpCmd = {
				'command':	'echo',
				'args':	[sql]
			};

			options['Content-Type']	= 'application/sql';
			options.intercom	= intercom1;
			options.log	= log;

			new amsync.SyncServer(options, cb);
		});

		// Write sync to db
		tasks.push(function (cb) {
			const	options	= {'exchange': exchangeName, 'intercom': intercom2, 'log': log, 'db': db};

			amsync.mariadb(options, cb);
		});

		// Check database
		tasks.push(function (cb) {
			db.query('SELECT * FROM bosse', function (err, rows) {
				if (err) throw err;

				assert.deepEqual(rows.length,	1);
				assert.deepEqual(rows[0].id,	1);
				assert.deepEqual(rows[0].name,	'duh');
				cb();
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;

			done();
		});
	});
});

describe('Custom http receiver', function () {
	it('should read path', function (done) {
		const	exchangeName	= 'test_dataDump_custom',
			intercom1	= new Intercom({'conStr': require(intercomConfigFile), 'log': log}),
			intercom2	= new Intercom({'conStr': require(intercomConfigFile), 'log': log}),
			tasks	= [];

		this.slow(500);

		// Wait for the intercoms to come online
		tasks.push(function (cb) {intercom1.ready(cb);});
		tasks.push(function (cb) {intercom2.ready(cb);});

		// Start server
		tasks.push(function (cb) {
			const	options	= {'exchange': exchangeName, 'intercom': intercom1, 'log': log};

			let	syncServer;

			syncServer	= new amsync.SyncServer(options, cb);

			syncServer.handleHttpReq_original	= syncServer.handleHttpReq;

			syncServer.handleHttpReq = function (req, res) {

				// Set custom content type
				res.setHeader('Content-Type', 'text/plain');
				//console.log(req);
				// Run different commands depending on request url
				if (req.url === '/') {
					syncServer.options.dataDumpCmd = {'command': 'echo', 'args': ['-n', 'blergh']};
				} else {
					syncServer.options.dataDumpCmd = {'command': 'echo', 'args': ['-n', req.url]};
				}

				// Run the original request handler
				syncServer.handleHttpReq_original(req, res);
			};
		});

		// Start the client
		tasks.push(function (cb) {
			const	options	= {'exchange': exchangeName, 'intercom': intercom2, 'log': log};

			options.requestOptions	= {'path': '/foobar'};

			new amsync.SyncClient(options, function (err, res) {
				let	syncData	= Buffer.from('');

				if (err) throw err;

				res.on('data', function (chunk) {
					syncData	=	Buffer.concat([syncData, chunk], syncData.length + chunk.length);
				});

				res.on('end', function () {
					assert.deepEqual(syncData.toString(), options.requestOptions.path);
					cb();
				});

				res.on('error', function (err) {
					throw err;
				});
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});
	});
});

after(function (done) {
	db.removeAllTables(done);
});
