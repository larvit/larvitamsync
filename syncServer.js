'use strict';

const	uuidLib	= require('uuid'),
	lUtils	= require('larvitutils'),
	spawn	= require('child_process').spawn,
	http	= require('http'),
	log	= require('winston'),
	os	= require('os'),
	nics	= os.networkInterfaces();

function SyncServer(options, cb) {
	const	that	= this;

	that.options	= options;

	if (that.options.intercom) {
		that.intercom = that.options.intercom;
	} else {
		that.intercom	= lUtils.instances.intercom;
	}

	// We are strictly in need of the intercom!
	if ( ! (that.intercom instanceof require('larvitamintercom'))) {
		const	err	= new Error('larvitutils.instances.intercom is not an instance of Intercom!');
		log.error('larvitamsync: syncServer.js - ' + err.message);
		throw err;
	}

	log.info('larvitamsync: syncServer.js - SyncServer started');

	// Subscribe to dump requests
	that.listenForRequests(cb);
}

SyncServer.prototype.handleHttpReq = function handleHttpReq(req, res) {
	const	that	= this;

	let	dumpProcess;

	if (req.headers.token !== req.token) {
		log.info('larvitamsync: syncServer.js - SyncServer.handleHttpReq() - Token: "' + req.token + '". Incoming message. Invalid token detected: "' + req.headers.token + '"');
		res.writeHead(401, {'Content-Type': 'text/plain; charset=utf-8'});
		res.end('Unauthorized');
		return;
	}

	if ( ! that.options.dataDumpCmd || ! that.options.dataDumpCmd.command) {
		const	err	= new Error('options.dataDumpCmd.command is a required option!');
		log.error('larvitamsync: syncServer.js - handleHttpReq() - Invalid options: ' + err.message);
		res.writeHead(500, { 'Content-Type':	'text/plain' });
		res.end('Internal server error');
		return;
	}

	log.verbose('larvitamsync: syncServer.js - SyncServer.handleHttpReq() - Token: "' + req.token + '". Incoming message with valid token.');

	dumpProcess	= spawn(that.options.dataDumpCmd.command, that.options.dataDumpCmd.args, that.options.dataDumpCmd.options);

	if ( ! res.getHeader('Content-Type'))	{ res.setHeader('Content-Type',	'Application/Octet-stream');	}
	if ( ! res.getHeader('Connection'))	{ res.setHeader('Connection',	'Transfer-Encoding');	}
	if ( ! res.getHeader('Transfer-Encoding'))	{ res.setHeader('Connection',	'chunked');	}

	dumpProcess.stdout.on('data', function(data) {
		res.write(data);
	});

	dumpProcess.stderr.on('data', function(data) {
		log.error('larvitamsync: syncServer.js - SyncServer.handleHttpReq() - Token: "' + req.token + '". Error from dump command: ' + data.toString());
	});

	dumpProcess.on('close', function() {
		log.debug('larvitamsync: syncServer.js - SyncServer.handleHttpReq() - Token: "' + req.token + '". Dump command closed.');
		res.end();
		clearTimeout(req.serverTimeout);
		req.server.close();
	});

	dumpProcess.on('error', function(err) {
		log.warn('larvitamsync: syncServer.js - SyncServer.handleHttpReq() - Token: "' + req.token + '". Non-0 exit code from dumpProcess. err: ' + err.message);
		res.writeHead(500, { 'Content-Type':	'text/plain' });
		res.end('Process error: ' + err.message);
	});
};

SyncServer.prototype.handleIncMsg = function handleIncMsg(message, ack) {
	const	token	= uuidLib.v4(),
		that	= this;

	let	serverTimeout,
		server;

	ack();

	log.debug('larvitamsync: syncServer.js - SyncServer.handleIncMsg() - Token: "' + token + '". Incoming message: ' + JSON.stringify(message));

	if (message.action !== 'reqestDump') {
		return;
	}

	log.debug('larvitamsync: syncServer.js - SyncServer.handleIncMsg() - Token: "' + token + '". Dump requested, starting http server.');

	server = http.createServer(function(req, res) {
		req.server	= server;
		req.serverTimeout	= serverTimeout;
		req.that	= that;
		req.token	= token;

		that.handleHttpReq(req, res);
	});
	server.listen(0);

	server.on('listening', function() {
		const	servedPort	= server.address().port,
			message	= {'action': 'dumpResponse', 'endpoints': []};

		for (const nic of Object.keys(nics)) {
			for (let i = 0; nics[nic][i] !== undefined; i ++) {
				const	nicAddress	= nics[nic][i];

				if (nicAddress.internal === false) {
					message.endpoints.push({
						'protocol':	'http',
						'family':	nicAddress.family,
						'host':	nicAddress.address,
						'port':	servedPort,
						'token':	token
					});
				}
			}
		}

		log.info('larvitamsync: syncServer.js - SyncServer.handleIncMsg() - http server started. Token: "' + token + '"');
		log.verbose('larvitamsync: syncServer.js - SyncServer.handleIncMsg() - http server started. Token: "' + token + '", endpoints: "' + JSON.stringify(message.endpoints) + '"');

		that.intercom.send(message, {'exchange': that.options.exchange});
	});

	serverTimeout = setTimeout(function() {
		log.verbose('larvitamsync: syncServer.js - SyncServer.handleIncMsg() - Token: "' + token + '". http server stopped due to timeout since no request came in.');
		server.close();
	}, 60000);
};

SyncServer.prototype.listenForRequests = function listenForRequests(cb) {
	const	that	= this;

	that.intercom.subscribe({'exchange': that.options.exchange}, function(message, ack, deliveryTag) {
		// We do this weirdness because it seems that becomes undefined if we pass it directly as a parameter
		that.handleIncMsg(message, ack, deliveryTag);
	}, cb);
};

exports = module.exports = SyncServer;
