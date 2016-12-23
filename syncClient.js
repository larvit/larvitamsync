'use strict';

const	lUtils	= require('larvitutils'),
	log	= require('winston');

function SyncClient(options, cb) {
	const	that	= this;

	that.intercom	= lUtils.instances.intercom;

	// We are strictly in need of the intercom!
	if ( ! (that.intercom instanceof require('larvitamintercom'))) {
		const	err	= new Error('larvitutils.instances.intercom is not an instance of Intercom!');
		log.error('larvitamsync: syncClient.js - ' + err.message);
		throw err;
	}

	log.info('larvitamsync: syncClient.js - SyncClient started with options: ' + JSON.stringify(options));

	that.options	= options;

	cb();
}

exports = module.exports = SyncClient;
