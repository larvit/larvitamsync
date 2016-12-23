'use strict';

const	intercom	= require('larvitutils').instances.intercom,
	log	= require('winston');

// We are strictly in need of the intercom!
if ( ! (intercom instanceof require('larvitamintercom'))) {
	const	err	= new Error('larvitutils.instances.intercom is not an instance of Intercom!');
	log.error('larvitamsync: index.js - ' + err.message);
	throw err;
}

exports.SyncServer	= require(__dirname + '/syncServer.js');
exports.mariadb	= require(__dirname + '/mariadb/index.js');
