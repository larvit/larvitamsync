'use strict';

const	topLogPrefix	= 'larvitamsync: syncServer.js: ',
	freePort	= require('find-free-port'),
	uuidLib	= require('uuid'),
	LUtils	= require('larvitutils'),
	lUtils	= new LUtils(),
	spawn	= require('child_process').spawn,
	http	= require('http'),
	nics	= require('os').networkInterfaces();

function SyncServer(options, cb) {
	const	that	= this;

	let	logPrefix	= topLogPrefix + 'SyncServer() - ';

	that.options	= options;
	that.intercom	= that.options.intercom;

	if ( ! options.log) {
		options.log	= new lUtils.Log();
	}

	that.log	= options.log;

	logPrefix += 'Exchange: "' + this.options.exchange + '" - ';

	// We are strictly in need of the intercom!
	if ( ! that.intercom) {
		const	err	= new Error('options.intercom is required!');
		that.log.error(logPrefix + err.message);
		throw err;
	}

	that.log.info(logPrefix + 'started');

	// Subscribe to dump requests
	that.listenForRequests(cb);
}

SyncServer.prototype.getFreePort = function getFreePort(minPort, maxPort, cb) {
	const	logPrefix	= topLogPrefix + '- getFreePort() - ',
		that	= this;

	freePort(minPort, maxPort, function (err, port) {
		if (err) {
			that.log.warn(logPrefix + 'No free port available, trying again. Error: ' + err.message);

			setTimeout(function () {
				that.getFreePort(minPort, maxPort, cb);
			}, 19);
		} else {
			cb(null, port);
		}
	});
};

SyncServer.prototype.handleHttpReq = function handleHttpReq(req, res) {
	const	logPrefix	= topLogPrefix + 'SyncServer.prototype.handleHttpReq() - Exchange: "' + this.options.exchange + '" - Token: "' + req.token + '" - ',
		that	= this;

	let	dumpProcess;

	if (req.headers.token !== req.token) {
		that.log.info(logPrefix + 'Incoming message. Invalid token detected: "' + req.headers.token + '"');
		res.writeHead(401, {'Content-Type': 'text/plain; charset=utf-8'});
		res.end('Unauthorized');
		return;
	}

	if ( ! that.options.dataDumpCmd || ! that.options.dataDumpCmd.command) {
		const	err	= new Error('options.dataDumpCmd.command is a required option!');
		that.log.error(logPrefix + 'Invalid options: ' + err.message);
		res.writeHead(500, { 'Content-Type':	'text/plain' });
		res.end('Internal server error');
		return;
	}

	that.log.verbose(logPrefix + 'Incoming message with valid token.');

	dumpProcess	= spawn(that.options.dataDumpCmd.command, that.options.dataDumpCmd.args, that.options.dataDumpCmd.options);

	if ( ! res.getHeader('Content-Type'))	{ res.setHeader('Content-Type',	'Application/Octet-stream');	}
	if ( ! res.getHeader('Connection'))	{ res.setHeader('Connection',	'Transfer-Encoding');	}
	if ( ! res.getHeader('Transfer-Encoding'))	{ res.setHeader('Connection',	'chunked');	}

	dumpProcess.stdout.on('data', function (data) {
		res.write(data);
	});

	dumpProcess.stderr.on('data', function (data) {
		that.log.warn(logPrefix + 'Error from dump command: ' + data.toString());
	});

	dumpProcess.on('close', function () {
		that.log.debug(logPrefix + 'Dump command closed.');
		res.end();
		clearTimeout(req.serverTimeout);
		req.server.close();
	});

	dumpProcess.on('error', function (err) {
		that.log.warn(logPrefix + 'Non-0 exit code from dumpProcess. err: ' + err.message);
		res.writeHead(500, { 'Content-Type':	'text/plain' });
		res.end('Process error: ' + err.message);
	});
};

SyncServer.prototype.handleIncMsg = function handleIncMsg(message, ack) {
	const	token	= uuidLib.v4(),
		logPrefix	= topLogPrefix + 'SyncServer.prototype.handleIncMsg() - Exchange: "' + this.options.exchange + '" - Token: "' + token + '" - ',
		that	= this;

	let	serverTimeout,
		server;

	ack();

	that.log.debug(logPrefix + 'Incoming message: ' + JSON.stringify(message));

	if (message.action !== 'requestDump') {
		return;
	}

	that.log.debug(logPrefix + 'Dump requested, starting http server.');

	server = http.createServer(function (req, res) {
		req.server	= server;
		req.serverTimeout	= serverTimeout;
		req.that	= that;
		req.token	= token;

		that.handleHttpReq(req, res);
	});

	server.on('listening', function () {
		const	servedPort	= server.address().port,
			message	= {'action': 'dumpResponse', 'endpoints': []};

		for (const nic of Object.keys(nics)) {
			for (let i = 0; nics[nic][i] !== undefined; i ++) {
				const	nicAddress	= nics[nic][i];

				if (nicAddress.internal === false) {
					message.endpoints.push({
						'protocol':	'http',
						'family':	nicAddress.family,
						'host':	that.options.host || nicAddress.address,
						'port':	servedPort,
						'token':	token
					});
				}
			}
		}

		that.log.info(logPrefix + 'http server started.');
		that.log.verbose(logPrefix + 'http server started. Endpoints: "' + JSON.stringify(message.endpoints) + '"');

		that.intercom.send(message, {'exchange': that.options.exchange});
	});

	serverTimeout = setTimeout(function () {
		that.log.verbose(logPrefix + 'http server stopped due to timeout since no request came in.');
		server.close();
	}, 60000);

	if (that.options.host) that.log.verbose(logPrefix + 'Using configured hostname "' + that.options.host + '"');

	if (that.options.minPort && that.options.maxPort) {
		that.log.verbose(logPrefix + 'port range between "' + that.options.minPort + '" and "' + that.options.maxPort + '" specified, trying to find available port');

		server.on('error', function (err) {
			if (err.message && err.message.substring(0, 17) === 'listen EADDRINUSE') {
				that.log.warn(logPrefix + 'Port: "' + err.message.substring(21) + '" in use, retrying');
				tryToGetFreePort();
			} else {
				that.log.error(logPrefix + err.message);
				throw err;
			}
		});

		function tryToGetFreePort() {
			that.getFreePort(that.options.minPort, that.options.maxPort, function (err, port) {
				if (err) {
					that.log.error(logPrefix + 'No available port found');
					return;
				}
				that.log.verbose(logPrefix + 'found port within range: "' + port + '"');
				server.listen(port);
			});
		}
		tryToGetFreePort();
	} else {
		server.listen(0);
		server.on('error', function (err) {
			that.log.error(logPrefix + err.message);
			throw err;
		});
	}
};

SyncServer.prototype.listenForRequests = function listenForRequests(cb) {
	const	that	= this;

	that.intercom.subscribe({'exchange': that.options.exchange}, function (message, ack, deliveryTag) {
		// We do this weirdness because it seems that becomes undefined if we pass it directly as a parameter
		that.handleIncMsg(message, ack, deliveryTag);
	}, cb);
};

exports = module.exports = SyncServer;
