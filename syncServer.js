'use strict';

const	lUtils	= require('larvitutils'),
	intercom	= lUtils.instances.intercom,
	uuidLib	= require('uuid'),
	http	= require('http'),
	log	= require('winston'),
	os	= require('os'),
	nics	= os.networkInterfaces();

function SyncServer(options, cb) {
	const	that	= this;

	log.info('larvitamsync: SyncServer started with options: ' + JSON.stringify(options));

	if ( ! options.dataDumpCmd || ! options.dataDumpCmd.command) {
		const	err	= new Error('options.dataDumpCmd.command is a required option!');
		log.warn('larvitamsync: SyncServer() - Invalid options: ' + err.message);
		cb(err);
		return;
	}

	that.options	= options;

	// Subscribe to dump requests
	that.listenForRequests(cb);

	return that.httpServer;
}

SyncServer.prototype.handleIncMsg = function handleIncMsg(message, ack) {
	const	token	= uuidLib.v4();

	let	serverTimeout,
		server;

	ack();

	log.debug('larvitamsync: SyncServer.handleIncMsg() - Token: "' + token + '". Incoming message: ' + JSON.stringify(message));

	if (message.action !== 'reqestDump') {
		return;
	}

	log.debug('larvitamsync: SyncServer.handleIncMsg() - Token: "' + token + '". Dump requested, starting http server.');

	function handleReq(req, res) {
		let	headersWritten	= false,
			dumpProcess;

		if (req.headers.token !== token) {
			log.info('larvitamsync: SyncServer.handleIncMsg() - handleReq() - Token: "' + token + '". Incoming message. Invalid token detected: "' + req.headers.token + '"');
			res.writeHead(401, {'Content-Type': 'text/plain; charset=utf-8'});
			res.end('Unauthorized');
			return;
		}

		log.verbose('larvitamsync: SyncServer.handleIncMsg() - handleReq() - Token: "' + token + '". Incoming message with valid token.');

		dumpProcess	= spawn(that.options.dataDumpCmd.command, that.options.dataDumpCmd.args, that.options.dataDumpCmd.options);

		function writeHeaders() {
			if (headersWritten === false) {
				log.debug('larvitamsync: SyncServer.handleIncMsg() - handelReq() - writeHeaderes() - Writing headers');
				res.writeHead(200, {
					'Connection':	'Transfer-Encoding',
					'Content-Type':	that.options['Content-Type'],
					'Transfer-Encoding':	'chunked'
				});

				headersWritten = true;
			}
		}

		dumpProcess.stdout.on('data', function(data) {
			writeHeaders();
			res.write(data.toString());
		});

		dumpProcess.stderr.on('data', function(data) {
			log.error('larvitamsync: SyncServer.handleIncMsg() - handleReq() - Token: "' + token + '". Error from dump command: ' + data.toString());
		});

		dumpProcess.on('close', function() {
			log.debug('larvitamsync: SyncServer.handleIncMsg() - handleReq() - Token: "' + token + '". Dump command closed.');
			writeHeaders();
			res.end();
			clearTimeout(serverTimeout);
			server.close();
		});

		dumpProcess.on('error', function(err) {
			res.writeHead(500, { 'Content-Type':	'text/plain' });
			res.end('Process error: ' + err.message);
		});
	}

	that.httpServer	= http.createServer(handleReq);
	that.httpServer.listen(0);

	that.httpServer.on('listening', function() {
		const	servedPort	= that.httpServer.address().port,
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

		log.info('larvitamsync: SyncServer.handleIncMsg() - http server started. Token: "' + token + '", endpoints: "' + JSON.stringify(message.endpoints) + '"');

		intercom.send(message, {'exchange': that.options.exchange});
	});

	serverTimeout = setTimeout(function() {
		log.verbose('larvitamsync: SyncServer.handleIncMsg() - Token: "' + token + '". http server stopped due to timeout since no request came in.');
		that.httpServer.close();
	}, 60000);
};

SyncServer.prototype.listenForRequests = function listenForRequests(cb) {
	const	that	= this;

	intercom.subscribe({'exchange': that.options.exchange}, that.handleIncMsg, cb);
};

exports = module.exports = SyncServer;
