'use strict';

const	SyncClient	= require(__dirname + '/syncClient.js'),
	uuidLib	= require('uuid'),
	spawn	= require('child_process').spawn,
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb'),
	os	= require('os'),
	fs	= require('fs');

function sync(options, cb) {
	const	tmpFileName	= os.tmpdir() + '/tmp_' + uuidLib.v4() + '.sql',
		tasks	= [],
		that	= this;

	that.options = options;

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
		const	mysqlOptions	= [],
			f	= fs.openSync(tmpFileName, 'r');

		if (db.conf.host) {
			mysqlOptions.push('-h');
			mysqlOptions.push(db.conf.host);
		} else if (db.conf.socketPath) {
			mysqlOptions.push('-S');
			mysqlOptions.push(db.conf.socketPath);
		}

		mysqlOptions.push('-u');
		mysqlOptions.push(db.conf.user);

		if (db.conf.password) {
			mysqlOptions.push('-p' + db.conf.password);
		}

		mysqlOptions.push(db.conf.database);

		let shMysql;

		shMysql	= spawn('mysql', mysqlOptions, {'stdio': [f, 'pipe', process.stderr]});

		shMysql.on('close', function() {
			log.info('larvitamsync: ./mariadb.js - sync() - Database synced on exchange: "' + that.options.exchange + '"');
			cb();
		});
	});

	// Remote tmp SQL file
	tasks.push(function(cb) {
		fs.unlink(tmpFileName, function(err) {
			if (err) {
				log.warn('larvitamsync: ./mariadb.js - sync() - Could not remove ' + tmpFilename + ' err: ' + err.message);
			}
			cb(err);
		});
	});

	async.series(tasks, cb);
}

exports = module.exports	= sync;
