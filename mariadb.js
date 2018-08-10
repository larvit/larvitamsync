'use strict';

const	topLogPrefix	= 'larvitamsync: mariadb.js: ',
	SyncClient	= require(__dirname + '/syncClient.js'),
	uuidLib	= require('uuid'),
	LUtils	= require('larvitutils'),
	lUtils	= new LUtils(),
	spawn	= require('child_process').spawn,
	async	= require('async'),
	os	= require('os'),
	fs	= require('fs');

function sync(options, cb) {
	const	tmpFileName	= os.tmpdir() + '/tmp_' + uuidLib.v4() + '.sql',
		logPrefix	= topLogPrefix + 'sync() - ',
		tasks	= [],
		that	= this;

	if ( ! options.log) {
		options.log	= new lUtils.Log();
	}

	if ( ! options.db) {
		const	err	= new Error('Required option "db" is missing');
		options.log.error(logPrefix + err.message);
		throw err;
	}

	that.options	= options;
	that.log	= that.options.log;
	that.db	= that.options.db;

	// Write tmp SQL file to disk
	tasks.push(function (cb) {
		const	tmpFile	= fs.createWriteStream(tmpFileName);

		new SyncClient(options, function (err, res) {
			if (err) return cb(err);

			res.pipe(tmpFile);

			res.on('error', function (err) {
				throw err; // Is logged upstream, but should stop app execution
			});

			res.on('end', cb);
		});
	});

	// Read SQL file to database
	tasks.push(function (cb) {
		const	mysqlOptions	= [],
			f	= fs.openSync(tmpFileName, 'r');

		if (that.db.conf.host) {
			mysqlOptions.push('-h');
			mysqlOptions.push(that.db.conf.host);
		} else if (that.db.conf.socketPath) {
			mysqlOptions.push('-S');
			mysqlOptions.push(that.db.conf.socketPath);
		}

		mysqlOptions.push('-u');
		mysqlOptions.push(that.db.conf.user);

		if (that.db.conf.password) {
			mysqlOptions.push('-p' + that.db.conf.password);
		}

		mysqlOptions.push(that.db.conf.database);

		let shMysql;

		shMysql	= spawn('mysql', mysqlOptions, {'stdio': [f, 'pipe', process.stderr]});

		shMysql.on('close', function () {
			that.log.info(logPrefix + 'Database synced on exchange: "' + that.options.exchange + '"');
			cb();
		});
	});

	// Remote tmp SQL file
	tasks.push(function (cb) {
		fs.unlink(tmpFileName, function (err) {
			if (err) {
				that.log.warn(logPrefix + 'Could not remove ' + tmpFilename + ' err: ' + err.message);
			}
			cb(err);
		});
	});

	async.series(tasks, cb);
}

exports = module.exports = sync;
