'use strict';

const	Intercom	= require('larvitamintercom'),
	lUtils	= require('larvitutils'),
	http	= require('http'),
	log	= require('winston');

function SyncClient(options, cb) {
	const	that	= this;

	that.options	= options;
	that.intercom	= lUtils.instances.intercom;
	that.responseReceived	= false;

	if (that.options.intercom) {
		that.intercom = that.options.intercom;
	} else {
		that.intercom	= lUtils.instances.intercom;
	}

	// We are strictly in need of the intercom!
	if ( ! (that.intercom instanceof Intercom)) {
		const	err	= new Error('larvitutils.instances.intercom is not an instance of Intercom!');
		log.error('larvitamsync: syncClient.js - ' + err.message);
		throw err;
	}

	// Reconnect so we have a fresh instance of intercom so we do not interfer with others
	that.intercom = new Intercom(that.intercom.conStr);
	that.intercom.on('ready', function(err) {
		if (err) { cb(err); return; }

		log.info('larvitamsync: syncClient.js - SyncClient started');

		that.options	= options;

		that.intercom.subscribe({'exchange': that.options.exchange}, function(message, ack) {
			// We do this weirdness because it seems that becomes undefined if we pass it directly as a parameter
			that.handleMsg(message, ack, cb);
		}, function(err) {
			if (err) { cb(err); return; }

			that.intercom.send({'action': 'reqestDump'}, {'exchange': that.options.exchange}, function(err) {
				if (err) { cb(err); return; }
			});
		});
	});
}

SyncClient.prototype.handleMsg = function(message, ack, cb) {
	const	reqOptions	= {},
		that	= this;

	let	req;

	log.debug('larvitamsync: syncClient.js - SyncClient.handleMsg() - Incoming message: "' + JSON.stringify(message) + '"');

	ack();

	if (message.action !== 'dumpResponse') {
		log.debug('larvitamsync: syncClient.js - SyncClient.handleMsg() - Ignoring message because action is not "dumpResponse", but: "' + message.action + '"');
		return;
	}

	if (that.responseReceived !== false) {
		log.debug('larvitamsync: syncClient.js - SyncClient.handleMsg() - Ignoring message because response is already received');
		return;
	}

	that.responseReceived = true; // Ignore future messages on this subscription

	if ( ! message.endpoints) {
		const	err	= new Error('message.endpoints does not contain network endpoints to connecto to');
		log.error('larvitamsync: syncClient.js - SyncClient.handleMsg() - ' + err.message);
		cb(err);
		return;
	}

	if ( ! message.endpoints[0].protocol) {
		message.endpoints[0].protocol = 'http';
	}

	reqOptions.protocol	= message.endpoints[0].protocol + ':';
	reqOptions.host	= message.endpoints[0].host;
	reqOptions.port	= message.endpoints[0].port;
	reqOptions.headers	= {'token': message.endpoints[0].token};

	if (that.options.requestOptions !== undefined) {
		for (const key of Object.keys(that.options.requestOptions)) {
			reqOptions[key] = that.options.requestOptions[key];
		}
	}

	log.verbose('larvitamsync: syncClient.js - SyncClient.handleMsg() - Sending request: "' + JSON.stringify(reqOptions) + '"');

	req = http.request(reqOptions, function(res) {
		if (res.statusCode !== 200) {
			const	err	= new Error('Non 200 statusCode: ' + res.statusCode);
			log.error('larvitamsync: syncClient.js - SyncClient.handleMsg() - Request failed: ' + err.message);
			cb(err);
		}

		res.on('error', function(err) {
			log.error('larvitamsync: syncClient.js - SyncClient.handleMsg() - res.on(error): ' + err.message);
		});

		cb(null, res);
	});
	req.end();
	req.on('error', function(err) {
		log.error('larvitamsync: syncClient.js - SyncClient.handleMsg() - Request failed: ' + err.message);
		cb(err);
	});

	that.intercom.close();
};

exports = module.exports = SyncClient;
