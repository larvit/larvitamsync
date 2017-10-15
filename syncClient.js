'use strict';

const	topLogPrefix	= 'larvitamsync: syncClient.js: ',
	Intercom	= require('larvitamintercom'),
	http	= require('http'),
	log	= require('winston');

function SyncClient(options, cb) {
	const	logPrefix	= topLogPrefix + 'SyncClient() - ',
		that	= this;

	that.options	= options;
	that.responseReceived	= false;
	that.extIntercom	= that.options.intercom;

	// We are strictly in need of the intercom!
	if ( ! (that.extIntercom instanceof Intercom)) {
		const	err	= new Error('options.intercom is not an instance of Intercom!');
		log.error(logPrefix + err.message);
		throw err;
	}

	// Reconnect so we have a fresh instance of intercom so we do not interfer with others
	log.verbose(logPrefix + 'Starting temporary intercom');

	if (that.extIntercom.conStr === 'loopback interface') {
		log.warn(logPrefix + 'Running intercom on "loopback interface", this is probably not what you want');
	}

	that.intercom = new Intercom(that.extIntercom.conStr);
	that.intercom.on('ready', function (err) {
		if (err) return cb(err);

		log.info(logPrefix + 'started on exchange: "' + that.options.exchange + '"');

		that.options	= options;

		that.intercom.subscribe({'exchange': that.options.exchange}, function (message, ack) {
			// We do this weirdness because it seems that becomes undefined if we pass it directly as a parameter
			that.handleMsg(message, ack, cb);
		}, function (err) {
			if (err) return cb(err);

			that.intercom.send({'action': 'requestDump'}, {'exchange': that.options.exchange}, function (err) {
				if (err) return cb(err);
			});
		});
	});
}

SyncClient.prototype.handleMsg = function (message, ack, cb) {
	const	reqOptions	= {},
		logPrefix	= topLogPrefix + 'SyncClient.prototype.handleMsg() - ',
		that	= this;

	let	req;

	log.debug(logPrefix + 'Incoming message: "' + JSON.stringify(message) + '"');

	ack();

	if (message.action !== 'dumpResponse') {
		log.debug(logPrefix + 'Ignoring message because action is not "dumpResponse", but: "' + message.action + '"');
		return;
	}

	if (that.responseReceived !== false) {
		log.debug(logPrefix + 'Ignoring message because response is already received');
		return;
	}

	that.responseReceived = true; // Ignore future messages on this subscription

	if ( ! message.endpoints) {
		const	err	= new Error('message.endpoints does not contain network endpoints to connecto to');
		log.error(logPrefix + err.message);
		return cb(err);
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

	log.verbose(logPrefix + 'Sending request: "' + JSON.stringify(reqOptions) + '"');

	req = http.request(reqOptions, function (res) {
		if (res.statusCode !== 200) {
			const	err	= new Error('Non 200 statusCode: ' + res.statusCode);
			log.error(logPrefix + 'Request failed: ' + err.message);
			return cb(err);
		}

		res.on('error', function (err) {
			log.error(logPrefix + 'res.on(error): ' + err.message);
		});

		cb(null, res);
	});
	req.end();
	req.on('error', function (err) {
		log.error(logPrefix + 'Request failed: ' + err.message);
		cb(err);
	});

	log.verbose(logPrefix + 'Closing temporary intercom');
	that.intercom.close();
};

exports = module.exports = SyncClient;
