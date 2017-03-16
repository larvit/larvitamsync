'use strict';

const	SyncClient	= require(__dirname + '/syncClient.js'),
	uuidLib	= require('uuid'),
	spawn	= require('child_process').spawn,
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb'),
	os	= require('os'),
	fs	= require('fs'),
	lUtils	= require('larvitutils'),
	logPrefix	= 'larvitamsync: esClient.js -';

function EsClient(options, cb) {
	const	tasks	= [],
		that	= this,
		options	= {};

	that.options = options;
	that.extIntercom	= lUtils.instances.intercom;
	that.responseReceived	= false;

	if (that.options.intercom) {
		that.extIntercom = that.options.intercom;
	} else {
		that.extIntercom	= lUtils.instances.intercom;
	}

	// We are strictly in need of the intercom!
	if ( ! (that.extIntercom instanceof Intercom)) {
		const	err	= new Error('larvitutils.instances.intercom is not an instance of Intercom!');
		log.error(logPrefix + err.message);
		throw err;
	}

	// ES needed to sync between ES instances...
	if (lUtils.instances.elasticsearch === undefined) {
		const	err	= new Error('larvitutils.instances.elasticsearch is not an instance of Intercom!');
		log.error(logPrefix + err.message);
		throw err;
	}

	// Reconnect so we have a fresh instance of intercom so we do not interfer with others
	that.intercom = new Intercom(that.extIntercom.conStr);
	that.intercom.on('ready', function(err) {
		if (err) { cb(err); return; }

		log.info(logPrefix + 'SyncClient started on exchange: "' + that.options.exchange + '"');

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

EsClient.prototype.handleMsg = function(message, ack, cb) {
	const	reqOptions	= {},
		that	= this,
		tasks	= [];

	let	req;

	log.debug(logPrefix + 'SyncClient.handleMsg() - Incoming message: "' + JSON.stringify(message) + '"');

	ack();

	if (message.action !== 'dumpResponse') {
		log.debug(logPrefix + 'SyncClient.handleMsg() - Ignoring message because action is not "dumpResponse", but: "' + message.action + '"');
		return;
	}

	if (that.responseReceived !== false) {
		log.debug(logPrefix + 'SyncClient.handleMsg() - Ignoring message because response is already received');
		return;
	}

	that.responseReceived = true; // Ignore future messages on this subscription

	if ( ! message.endpoints) {
		const	err	= new Error('message.endpoints does not contain network endpoints to connecto to');
		log.error(logPrefix + 'SyncClient.handleMsg() - ' + err.message);
		cb(err);
		return;
	}
/*
	if ( ! message.endpoints[0].token.length === 3) {
		const	err	= new Error('Not enough tookens issued to complete sync');
		log.error(logPrefix + 'SyncClient.handleMsg() - ' + err.message);
		cb(err);
		return;
	} */

	if ( ! message.endpoints[0].protocol) {
		message.endpoints[0].protocol = 'http';
	}

	for (let cmd in that.options)

	tasks.push(function (cb) {


		reqOptions.protocol	= message.endpoints[0].protocol + ':';
		reqOptions.host	= message.endpoints[0].host;
		reqOptions.port	= message.endpoints[0].port;
		reqOptions.headers	= {'token': message.endpoints[0].token[0]};

		if (that.options.requestOptions !== undefined) {
			for (const key of Object.keys(that.options.requestOptions)) {
				reqOptions[key] = that.options.requestOptions[key];
			}
		}

		log.verbose(logPrefix + 'SyncClient.handleMsg() - Sending request: "' + JSON.stringify(reqOptions) + '"');

		req = http.request(reqOptions, function(res) {
			if (res.statusCode !== 200) {
				const	err	= new Error('Non 200 statusCode: ' + res.statusCode);
				log.error(logPrefix + 'SyncClient.handleMsg() - Request failed: ' + err.message);
				cb(err);
			}

			res.on('error', function(err) {
				log.error(logPrefix + 'SyncClient.handleMsg() - res.on(error): ' + err.message);
			});

			cb(null, res);
		});

		req.end();

		req.on('error', function(err) {
			log.error(logPrefix + 'SyncClient.handleMsg() - Request failed: ' + err.message);
			cb(err);
		});

	});







	that.intercom.close();
};

exports = module.exports	= EsClient;