'use strict';

const	SyncClient	= require(__dirname + '/syncClient.js'),
	uuidLib	= require('uuid'),
	mysql	= require('mysql2'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb'),
	os	= require('os'),
	fs	= require('fs'),
	_	= require('lodash');

function sync(options, cb) {
	const	tmpFileName	= os.tmpdir() + '/tmp_' + uuidLib.v4() + '.sql',
		tasks	= [];

	// Write tmp SQL file to disk
	tasks.push(function(cb) {
		const	tmpFile	= fs.createWriteStream(tmpFileName);

		new SyncClient(options, function(err, res) {
			if (err) { cb(err); return; }

			res.pipe(tmpFile);

			res.on('error', function(err) {
				throw err; // Is logged upstream, but should stop app execution
			});

			res.on('end', cb);
		});
	});

	// Read SQL file to database
	tasks.push(function(cb) {
		const	localDbConf	= _.cloneDeep(db.conf);

		let	dbCon;

		localDbConf.multipleStatements	= true;
		dbCon	= mysql.createConnection(localDbConf);

		dbCon.query(fs.readFileSync(tmpFileName).toString(), function(err) {
			if (err) {
				log.error('larvitamsync: ./mariadb.js - sync() - SQL error: ' + err.message);
			} else {
				log.info('larvitamsync: ./mariadb.js - sync() - Database synced!');
			}

			dbCon.end(function(err) {
				if (err) {
					log.warn('larvitamsync: ./mariadb.js - sync() - Could not end() database connection, err: ' + err.message);
				}

				cb(err);
			});
		});
	});

	// Remote tmp SQL file
	tasks.push(function(cb) {
		fs.unlink(tmpFileName, cb);
	});

	async.series(tasks, cb);
}

exports = module.exports	= sync;
