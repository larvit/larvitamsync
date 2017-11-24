'use strict';

const	Intercom	= require('larvitamintercom'),
	request	= require('request'),
	assert	= require('assert'),
	amsync	= require(__dirname + '/../index.js'),
	async	= require('async'),
	http	= require('http'),
	nics	= require('os').networkInterfaces(),
	log	= require('winston'),
	sql	= 'CREATE TABLE `bosse` (`id` int NOT NULL AUTO_INCREMENT PRIMARY KEY, `name` varchar(255) NOT NULL); INSERT INTO bosse (name) VALUES(\'duh\');',
	db	= require('larvitdb'),
	fs	= require('fs'),
	_	= require('lodash');

let	intercomConfigFile,
	intercom;

// Set up winston
log.remove(log.transports.Console);
/**/log.add(log.transports.Console, {
	'level':	'warn',
	'colorize':	true,
	'timestamp':	true,
	'json':	false
});/**/

before(function (done) {
	this.timeout(10000);
	const	tasks	= [];

	// Run DB Setup
	tasks.push(function (cb) {
		let confFile;

		if (process.env.DBCONFFILE === undefined) {
			confFile = __dirname + '/../config/db_test.json';
		} else {
			confFile = process.env.DBCONFFILE;
		}

		log.verbose('DB config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function (err) {
			if (err) {

				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function (err) {
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
			intercomConfigFile = __dirname + '/../config/amqp_test.json';
		} else {
			intercomConfigFile = process.env.INTCONFFILE;
		}

		log.verbose('Intercom config file: "' + intercomConfigFile + '"');

		// First look for absolute path
		fs.stat(intercomConfigFile, function (err) {
			if (err) {

				// Then look for this string in the config folder
				intercomConfigFile = __dirname + '/../config/' + intercomConfigFile;
				fs.stat(intercomConfigFile, function (err) {
					if (err) throw err;
					log.verbose('Intercom config: ' + JSON.stringify(require(intercomConfigFile)));
					intercom	= new Intercom(require(intercomConfigFile));
					intercom.on('ready', cb);
				});

				return;
			}

			log.verbose('Intercom config: ' + JSON.stringify(require(intercomConfigFile)));
			intercom = new Intercom(require(intercomConfigFile));
			intercom.on('ready', cb);
		});
	});

	async.series(tasks, done);
});

describe('Basics', function () {
	it('server', function (done) {
		const	exchangeName	= 'test_dataDump_server',
			intercom1	= new Intercom(require(intercomConfigFile)),
			intercom2	= new Intercom(require(intercomConfigFile)),
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

			new amsync.SyncServer(options, cb);
		});

		// Subscribe to happenings on the queue on intercom1
		tasks.push(function (cb) {
			intercom1.subscribe({'exchange': exchangeName}, handleMsg, cb);
		});

		// Send the request to the queue
		tasks.push(function (cb) {
			intercom1.send({'action': 'requestDump', 'noOfTokens': 1}, {'exchange': exchangeName}, cb);
		});

		async.series(tasks, function (err) {
			if (err) throw err;
		});
	});

	it('client', function (done) {
		const	exchangeName	= 'test_dataDump_client',
			msgContent	= 'wlüpp!',
			intercom1	= new Intercom(require(intercomConfigFile)),
			intercom2	= new Intercom(require(intercomConfigFile)),
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
			const	options	= {'exchange': exchangeName, 'intercom': intercom2};

			new amsync.SyncClient(options, function (err, res) {
				let	syncData	= Buffer.from('');

				if (err) { cb(err); return; }

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
		const	exchangeName	= 'test_dataDump_server',
			intercom1	= new Intercom(require(intercomConfigFile)),
			intercom2	= new Intercom(require(intercomConfigFile)),
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

			console.log(message.endpoints[0]);
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

			new amsync.SyncServer(options, cb);
		});

		// Subscribe to happenings on the queue on intercom1
		tasks.push(function (cb) {
			intercom1.subscribe({'exchange': exchangeName}, handleMsg, cb);
		});

		// Send the request to the queue
		tasks.push(function (cb) {
			intercom1.send({'action': 'requestDump', 'noOfTokens': 1}, {'exchange': exchangeName}, cb);
		});

		async.series(tasks, function (err) {
			if (err) throw err;
		});
	});
});

describe('Database', function () {
	it('should sync MariaDB/MySQL stuff', function (done) {
		const	exchangeName	= 'test_dataDump_mariadb',
			intercom1	= new Intercom(require(intercomConfigFile)),
			intercom2	= new Intercom(require(intercomConfigFile)),
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

			new amsync.SyncServer(options, cb);
		});

		// Write sync to db
		tasks.push(function (cb) {
			const	options	= {'exchange': exchangeName, 'intercom': intercom2};

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
			intercom1	= new Intercom(require(intercomConfigFile)),
			intercom2	= new Intercom(require(intercomConfigFile)),
			tasks	= [];

		this.slow(500);

		// Wait for the intercoms to come online
		tasks.push(function (cb) {intercom1.ready(cb);});
		tasks.push(function (cb) {intercom2.ready(cb);});

		// Start server
		tasks.push(function (cb) {
			const	options	= {'exchange': exchangeName, 'intercom': intercom1};

			let	syncServer;

			syncServer = new amsync.SyncServer(options, cb);

			syncServer.handleHttpReq_original = syncServer.handleHttpReq;

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
			const	options	= {'exchange': exchangeName, 'intercom': intercom2};

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
