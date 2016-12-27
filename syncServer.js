'use strict';

const	lUtils	= require('larvitutils'),
	uuidLib	= require('uuid'),
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

	if ( ! that.options.dataDumpCmd || ! that.options.dataDumpCmd.command) {
		const	err	= new Error('options.dataDumpCmd.command is a required option!');
		log.warn('larvitamsync: syncServer.js - SyncServer() - Invalid options: ' + err.message);
		cb(err);
		return;
	}

	// Subscribe to dump requests
	that.listenForRequests(cb);
}

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

	function handleReq(req, res) {
		let	headersWritten	= false,
			dumpProcess;

		if (req.headers.token !== token) {
			log.info('larvitamsync: syncServer.js - SyncServer.handleIncMsg() - handleReq() - Token: "' + token + '". Incoming message. Invalid token detected: "' + req.headers.token + '"');
			res.writeHead(401, {'Content-Type': 'text/plain; charset=utf-8'});
			res.end('Unauthorized');
			return;
		}

		log.verbose('larvitamsync: syncServer.js - SyncServer.handleIncMsg() - handleReq() - Token: "' + token + '". Incoming message with valid token.');

		dumpProcess	= spawn(that.options.dataDumpCmd.command, that.options.dataDumpCmd.args, that.options.dataDumpCmd.options);

		function writeHeaders() {
			let	contentType	= that.options['Content-Type'];

			if ( ! contentType) {
				contentType = 'Application/Octet-stream';
			}

			if (headersWritten === false) {
				log.debug('larvitamsync: syncServer.js - SyncServer.handleIncMsg() - handelReq() - writeHeaderes() - Writing headers');
				res.writeHead(200, {
					'Connection':	'Transfer-Encoding',
					'Content-Type':	contentType,
					'Transfer-Encoding':	'chunked'
				});

				headersWritten = true;
			}
		}

		dumpProcess.stdout.on('data', function(data) {
			writeHeaders();
			res.write(data);
		});

		dumpProcess.stderr.on('data', function(data) {
			log.error('larvitamsync: syncServer.js - SyncServer.handleIncMsg() - handleReq() - Token: "' + token + '". Error from dump command: ' + data.toString());
		});

		dumpProcess.on('close', function() {
			log.debug('larvitamsync: syncServer.js - SyncServer.handleIncMsg() - handleReq() - Token: "' + token + '". Dump command closed.');
			writeHeaders();
			res.end();
			clearTimeout(serverTimeout);
			server.close();
		});

		dumpProcess.on('error', function(err) {
			log.warn('larvitamsync: syncServer.js - SyncServer.handleIncMsg() - handleReq() - Token: "' + token + '". Non-0 exit code from dumpProcess. err: ' + err.message);
			res.writeHead(500, { 'Content-Type':	'text/plain' });
			res.end('Process error: ' + err.message);
		});
	}

	server	= http.createServer(handleReq);
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
