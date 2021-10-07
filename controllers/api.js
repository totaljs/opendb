const DB = {};
const HEADERS = { 'x-opendb': MAIN.version, 'user-argent': 'OpenDB' };
const FILTER = 'type:string, id:string, callbackid:string, db:string, take:number, skip:number, first:boolean, filter:string, filterarg:object, modify:string, modifyarg:object, scalar:string, scalararg:object, sort:string, fields: string, data:object, expire:string, date:date';
const FILETYPES = { files_read: 1, files_remove: 1, files_browse: 1, inmemory_save: 1, inmemory_remove: 1, inmemory_find: 1, inmemory_read: 1 };

MAIN.inmemorydb = {};

exports.install = function() {

	ROUTE('+SOCKET  /', socket, 1024);
	ROUTE('+POST    /', http, 1024);

	// Files
	ROUTE('+POST    /files/', upload, ['upload'], 1024 * 100);
	ROUTE('FILE     /files/*.*', file);

	// Index
	ROUTE('GET /', index);
};

function index() {
	if (PREF.token)
		this.plain('OpenDB v' + MAIN.version);
	else
		this.redirect('/setup/');
}

function audit(client, msg) {
	msg.token = client.user.token;
	msg.ua = client.ua;
	msg.ip = client.ip;
	msg.dtcreated = new Date();
	F.Fs.appendFile(PATH.databases('audit.log'), JSON.stringify(msg) + '\n', NOOP);
}

function DATABASE(name) {

	var db = TEXTDB(name);

	if (!db.oninsert) {
		db.$name = name;
		db.oninsert = function(doc) {

			var evt = 'db_insert';
			F.$events[evt] && EMIT(evt, db.$name, doc);

			if (CONF.allow_tms && F.tms.publish_cache.insert && F.tms.publishers.insert)
				PUBLISH('insert', { db: db.$name, data: doc });
		};
		db.onupdate = function(doc) {

			var evt = 'db_update';
			F.$events[evt] && EMIT(evt, db.$name, doc);

			if (CONF.allow_tms && F.tms.publish_cache.update && F.tms.publishers.update)
				PUBLISH('update', { db: db.$name, data: doc });
		};
		db.onremove = function(doc) {

			var evt = 'db_remove';
			F.$events[evt] && EMIT(evt, db.$name, doc);

			if (CONF.allow_tms && F.tms.publish_cache.remove && F.tms.publishers.remove)
				PUBLISH('remove', { db: db.$name, data: doc });

		};
	}

	return db;
}

function resend(msg) {
	PREF.resend.wait(function(item, next) {

		if (msg.origin && item.url.indexOf(msg.origin, 7) !== -1) {
			next();
			return;
		}

		var opt = {};
		opt.url = item.url;
		opt.body = msg;
		opt.keepalive = true;
		opt.headers = HEADERS;
		opt.type = 'json';

		// @TODO: improve error handling
		opt.callback = next;

		REQUEST(opt);
	});
}

function resend_fs(controller, callback) {
	PREF.resend.wait(function(item, next) {

		if (controller.uri.hostname && item.url.indexOf(controller.uri.hostname, 7) !== -1) {
			next();
			return;
		}

		var opt = {};
		opt.url = item.url;
		opt.keepalive = true;
		opt.headers = HEADERS;
		opt.files = [];

		for (var file of controller.files)
			opt.files.push({ name: file.filename, filename: file.path });

		// @TODO: improve error handling
		opt.callback = next;

		REQUEST(opt);

	}, callback);
}

function stats(session, msg) {

	if (!MAIN.stats[session.token])
		MAIN.stats[session.token] = { total: {}, today: {} };

	if (MAIN.stats[session.token].total[msg.type])
		MAIN.stats[session.token].total[msg.type]++;
	else
		MAIN.stats[session.token].total[msg.type] = 1;

	if (MAIN.stats[session.token].today[msg.type])
		MAIN.stats[session.token].today[msg.type]++;
	else
		MAIN.stats[session.token].today[msg.type] = 1;

	MAIN.stats.save();
}

function socket() {

	var self = this;

	MAIN.socket = self;

	self.on('open', function(client) {
		client.send({ type: 'init', name: PREF.name, version: MAIN.version });
	});

	self.on('message', function(client, msg) {

		if (PREF.log_requests)
			audit(client, msg);

		var model = CONVERT(msg, FILTER);
		var db = DB[model.type];
		if (db) {

			if (!model.db && !FILETYPES[model.type]) {
				client.send({ callbackid: msg.callbackid, error: 'Missing "db" name' });
				return;
			}

			msg.origin = client.uri.hostname;
			stats(client.user, msg, 'ws');

			// Resend to other servers
			PREF.resend && PREF.resend.length && resend(msg);

			db(client.user, model, function(err, response) {
				var data = {};
				data.callbackid = model.callbackid;
				data.response = response;
				client.send(data);
			});

		} else
			client.send({ callbackid: msg.callbackid, error: 'Not supported "type"' });
	});
}

function http() {

	var self = this;

	if (PREF.log_requests)
		audit(self, self.body);

	var model = CONVERT(self.body, FILTER);
	var db = DB[model.type];
	if (db) {
		if (model.db || FILETYPES[model.type]) {

			self.body.origin = self.uri.hostname;

			// Resend to other servers
			PREF.resend && PREF.resend.length && resend(self.body);
			stats(self.user, self.body, 'http');

			db(self.user, model, function(err, response) {
				if (err)
					self.invalid(err);
				else
					self.json(response);
			});

		} else
			self.invalid('Missing "db" name');
	} else
		self.invalid('Not supported "type"');
}

function applyfilter(builder, query) {

	query.take && builder.take(query.take);
	query.skip && builder.skip(query.skip);
	query.limit && builder.limit(query.limit);
	query.first && builder.first();
	query.sort && builder.sort(query.sort);
	query.fields && builder.fields(query.fields);

	if (query.filter) {
		builder.options.filter = [query.filter];
		if (query.filterarg)
			builder.options.filterarg = query.filterarg;
	} else
		query.filter = ['true'];

	if (query.modify) {
		builder.options.modify = query.modify;
		if (query.modifyarg)
			builder.options.modifyarg = query.modifyarg;
	}

	if (query.scalar) {
		builder.options.scalar = query.scalar;
		if (query.scalararg)
			builder.options.scalararg = query.scalararg;
		else
			builder.options.scalararg = {};
	}

	return builder;
}

DB.scalar = function(session, query, callback) {

	if (!session.sa && session.databases && !session.databases[query.db]) {
		callback('Not allowed');
		return;
	}

	applyfilter(DATABASE(query.db).scalar(), query).callback(callback);
};

DB.find = function(session, query, callback) {

	if (!session.sa && session.databases && !session.databases[query.db]) {
		callback('Not allowed');
		return;
	}

	applyfilter(DATABASE(query.db).find(), query).callback(callback);
};

DB.list = function(session, query, callback) {

	if (!session.sa && session.databases && !session.databases[query.db]) {
		callback('Not allowed');
		return;
	}

	applyfilter(DATABASE(query.db).list(), query).callback(callback);
};

DB.insert = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || (session.databases && !session.databases[query.db]))) {
		callback('Not allowed');
		return;
	}

	PREF.log && FUNC.transationlog(query);
	DATABASE(query.db).insert(query.data).callback(callback);
};

DB.modify = DB.update = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || (session.databases && !session.databases[query.db]))) {
		callback('Not allowed');
		return;
	}

	PREF.log && FUNC.transationlog(query);

	if (query.data) {
		applyfilter(DATABASE(query.db).modify(query.data), query).callback(callback);
	} else {
		// Internal hack
		var builder = TEXTDB(query.db).remove();
		builder.command = 'update';
		applyfilter(builder, query).callback(callback);
	}
};

DB.read = function(session, query, callback) {

	if (!session.sa && session.databases && !session.databases[query.db]) {
		callback('Not allowed');
		return;
	}

	applyfilter(DATABASE(query.db).one(), query).callback(callback);
};

DB.drop = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || (session.databases && !session.databases[query.db]))) {
		callback('Not allowed');
		return;
	}

	DATABASE(query.db).drop();
	callback && callback();
};

DB.remove = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || (session.databases && !session.databases[query.db]))) {
		callback('Not allowed');
		return;
	}

	PREF.log && FUNC.transationlog(query);
	applyfilter(DATABASE(query.db).remove(), query).callback(callback);
};

DB.stats_save = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || (session.databases && !session.databases[query.db]))) {
		callback('Not allowed');
		return;
	}

	if (!query.id) {
		callback('Missing "id"');
		return;
	}

	// query.db {String}
	// query.id {String}
	// query.data {Number}
	// query.date {Date}

	if (!query.date)
		query.date = NOW;

	var y = query.date.getFullYear();
	var m = query.date.getMonth() + 1;
	var d = query.date.getDate();
	var h = query.date.getHours();
	var w = +query.date.format('w');
	var data;
	var db;
	var ts;
	var id;

	PREF.log && FUNC.transationlog(query);

	db = query.db + '_h';
	ts = +query.date.format('yyyyMMddHH');
	id = query.id + '_' + ts;
	data = { uid: id, id: query.id, '>min': query.data, '<max': query.data, '+count': 1, year: y, month: m, week: w, day: d, hour: h, ts: ts, dtupdated: NOW };
	DATABASE(db).modify(data, true).where('uid', id).take(1);

	db = query.db + '_d';
	ts = +query.date.format('yyyyMMdd');
	id = query.id + '_' + ts;
	data = { uid: id, id: query.id, '>min': query.data, '<max': query.data, '+count': 1, year: y, month: m, week: w, day: d, ts: ts, dtupdated: NOW };
	DATABASE(db).modify(data, true).where('uid', id).take(1);

	db = query.db + '_w';
	ts = +query.date.format('yyyyMMww');
	id = query.id + '_' + ts;
	data = { uid: id, id: query.id, '>min': query.data, '<max': query.data, '+count': 1, year: y, month: m, week: w, ts: ts, dtupdated: NOW };
	DATABASE(db).modify(data, true).where('uid', id).take(1);

	db = query.db + '_m';
	ts = +query.date.format('yyyyMM');
	id = query.id + '_' + ts;
	data = { uid: id, id: query.id, '>min': query.data, '<max': query.data, '+count': 1, year: y, month: m, ts: ts, dtupdated: NOW };
	DATABASE(db).modify(data, true).where('uid', id).take(1);

	db = query.db + '_y';
	ts = +query.date.format('yyyy');
	id = query.id + '_' + ts;
	data = { uid: id, id: query.id, '>min': query.data, '<max': query.data, '+count': 1, year: y, ts: ts, dtupdated: NOW };
	DATABASE(db).modify(data, true).where('uid', id).take(1);

	callback && callback(SUCCESS(true));
};

DB.stats_remove = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || (session.databases && !session.databases[query.db]))) {
		callback('Not allowed');
		return;
	}

	if (!query.id) {
		callback('Missing "id"');
		return;
	}

	PREF.log && FUNC.transationlog(query);

	var db;

	db = query.db + '_h';
	if (query.id)
		DATABASE(db).remove().where('id', query.id);
	else
		applyfilter(DATABASE(db).remove(), query);

	db = query.db + '_d';
	if (query.id)
		DATABASE(db).remove().where('id', query.id);
	else
		applyfilter(DATABASE(db).remove(), query);

	db = query.db + '_w';
	if (query.id)
		DATABASE(db).remove().where('id', query.id);
	else
		applyfilter(DATABASE(db).remove(), query);

	db = query.db + '_m';
	if (query.id)
		DATABASE(db).remove().where('id', query.id);
	else
		applyfilter(DATABASE(db).remove(), query);

	db = query.db + '_y';
	if (query.id)
		DATABASE(db).remove().where('id', query.id);
	else
		applyfilter(DATABASE(db).remove(), query);

	callback && callback(SUCCESS(true));
};

DB.stats_hourly = function(session, query, callback) {

	if (!session.sa && session.databases && !session.databases[query.db]) {
		callback('Not allowed');
		return;
	}

	applyfilter(DATABASE(query.db + '_h').find(), query).callback(callback);
};

DB.stats_daily = function(session, query, callback) {

	if (!session.sa && session.databases && !session.databases[query.db]) {
		callback('Not allowed');
		return;
	}

	applyfilter(DATABASE(query.db + '_d').find(), query).callback(callback);
};

DB.stats_weekly = function(session, query, callback) {

	if (!session.sa && session.databases && !session.databases[query.db]) {
		callback('Not allowed');
		return;
	}

	applyfilter(DATABASE(query.db + '_w').find(), query).callback(callback);
};

DB.stats_monthly = function(session, query, callback) {

	if (!session.sa && session.databases && !session.databases[query.db]) {
		callback('Not allowed');
		return;
	}

	applyfilter(DATABASE(query.db + '_m').find(), query).callback(callback);
};

DB.stats_yearly = function(session, query, callback) {

	if (!session.sa && session.databases && !session.databases[query.db]) {
		callback('Not allowed');
		return;
	}

	applyfilter(DATABASE(query.db + '_y').find(), query).callback(callback);
};

DB.stats_drop = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || (session.databases && !session.databases[query.db]))) {
		callback('Not allowed');
		return;
	}

	var evt = 'db_drop';
	DATABASE(query.db + '_h').drop();
	F.$events[evt] && EMIT(evt, query.db + '_h');

	DATABASE(query.db + '_d').drop();
	F.$events[evt] && EMIT(evt, query.db + '_d');

	DATABASE(query.db + '_w').drop();
	F.$events[evt] && EMIT(evt, query.db + '_w');

	DATABASE(query.db + '_m').drop();
	F.$events[evt] && EMIT(evt, query.db + '_m');

	DATABASE(query.db + '_y').drop();
	F.$events[evt] && EMIT(evt, query.db + '_y');

	callback && callback();
};

DB.inmemory_save = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || !session.allow_inmemory)) {
		callback('Not allowed');
		return;
	}

	if (typeof(query.data) !== 'object') {
		callback('Invalid data');
		return;
	}

	var dbname = query.db || 'inmemory';
	var db = MAIN.inmemorydb[dbname];
	if (!db) {
		db = { items: {} };
		MAIN.inmemorydb[dbname] = db;
	}

	var item = db[query.id];
	if (!item) {
		item = { data: {} };
		db.items[query.id] = item;
	}

	if (query.expire)
		item.expire = NOW.add(query.expire);

	if (!item.data.id)
		item.data.id = query.id;

	if (typeof(query.data) === 'object') {
		for (var key in query.data)
			item.data[key] = query.data[key];
	} else
		item.data = query.data;

	db.dtupdated = NOW;

	var evt = 'inmemory_save';
	F.$events[evt] && EMIT(evt, dbname, item.data);

	if (CONF.allow_tms && F.tms.publish_cache.inmemory_save && F.tms.publishers.inmemory_save)
		PUBLISH('inmemory_save', { db: dbname, id: query.id, data: item.data, expire: item.expire });

	callback(null, SUCCESS(true));
};

DB.inmemory_read = function(session, query, callback) {

	if (!session.sa && !session.allow_inmemory) {
		callback('Not allowed');
		return;
	}

	var dbname = query.db || 'inmemory';
	var db = MAIN.inmemorydb[dbname];
	if (db) {
		db.dtread = NOW;
		var item = db.items[query.id];
		if (item && (!item.expire || item.expire > NOW)) {

			if (query.expire)
				item.expire = NOW.add(query.expire);

			if (query.fields) {
				var fields = query.fields.split(',');
				var data = {};

				for (var field of fields) {
					var key = field.trim();
					data[key] = item.data[key];
				}

				callback(null, data);
				return;
			}
		}
	}
	callback(null, null);
};

DB.inmemory_find = function(session, query, callback) {

	if (!session.sa && !session.allow_inmemory) {
		callback('Not allowed');
		return;
	}

	var dbname = query.db || 'inmemory';
	var fields;

	if (query.fields)
		fields = query.fields.split(',').trim();

	var reader = U.reader([]);
	var builder = reader.find();

	applyfilter(builder, query);
	builder.callback(callback);

	try {
		var db = MAIN.inmemorydb[dbname];
		if (db) {
			db.dtread = NOW;
			for (var key in db.items) {
				var item = db.items[key];
				if (!item.expire || item.expire > NOW)
					reader.push(item.data);
			}
		}
		reader.push(null);
	} catch (e) {
		callback(e.message);
	}
};

DB.inmemory_remove = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || !session.allow_inmemory)) {
		callback('Not allowed');
		return;
	}

	var dbname = query.db || 'inmemory';
	var db = MAIN.inmemorydb[dbname];
	if (db && db.items[query.id]) {
		db.dtupdated = NOW;
		var data = db.items[query.id];
		var evt = 'inmemory_remove';
		F.$events[evt] && EMIT(evt, dbname, data.data);
		if (CONF.allow_tms && F.tms.publish_cache.inmemory_remove && F.tms.publishers.inmemory_remove)
			PUBLISH('inmemory_remove', { db: dbname, id: query.id, data: data.data });
		delete db[query.id];
	}

	callback(null, SUCCESS(true));
};

DB.inmemory_drop = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || !session.allow_inmemory)) {
		callback('Not allowed');
		return;
	}

	var dbname = query.db || 'inmemory';
	var db = MAIN.inmemorydb[dbname];
	if (db) {
		var evt = 'inmemory_drop';
		F.$events[evt] && EMIT(evt, dbname);
		if (CONF.allow_tms && F.tms.publish_cache.inmemory_drop && F.tms.publishers.inmemory_drop)
			PUBLISH('inmemory_drop', { db: dbname });
		delete MAIN.inmemorydb[dbname];
	}

	callback(null, SUCCESS(true));
};

DB.files_read = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || !session.allow_filestorage)) {
		callback('Not allowed');
		return;
	}

	if (!query.id) {
		callback('Missing "id"');
		return;
	}

	FILESTORAGE('files').read(query.id, callback, true);
};

DB.files_remove = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || !session.allow_filestorage)) {
		callback('Not allowed');
		return;
	}

	if (!query.id) {
		callback('Missing "id"');
		return;
	}

	var evt = 'files_remove';
	F.$events[evt] && EMIT(evt, query.id);

	FILESTORAGE('files').remove(query.id, callback);
};

DB.files_browse = function(session, query, callback) {

	if (!session.sa && (session.allow_readonly || !session.allow_filestorage)) {
		callback('Not allowed');
		return;
	}

	applyfilter(FILESTORAGE('files').browse(callback), query);
};

function upload() {

	var self = this;

	if (!session.sa && (self.session.allow_readonly || !self.session.allow_filestorage)) {
		self.status = 401;
		self.invalid('Not allowed');
		return;
	}

	var output = [];

	self.files.wait(function(file, next) {
		var obj = {};
		obj.id = self.query.id || self.body[file.name + '_id'] || UID();
		obj.name = file.filename;
		obj.size = file.size;
		obj.type = file.type;
		obj.width = file.width;
		obj.height = file.height;
		obj.ext = file.extension;
		file.fs('files', obj.id, next);
		obj.id = obj.id + '-' + FUNC.checksum(obj.id);
		obj.url = '/files/' + obj.id + '.' + file.extension;
		output.push(obj);
		stats(self.user, { type: 'upload' });

		var evt = 'files_save';
		F.$events[evt] && EMIT(evt, obj.id, obj);

		if (CONF.allow_tms && F.tms.publish_cache.upload && F.tms.publishers.upload)
			PUBLISH('upload', { data: obj });

	}, function() {

		if (self.files.length && PREF.resend && PREF.resend.length) {
			resend_fs(self, () => self.clear());
			self.autoclear(false);
		}

		self.json(output);

	});
}

function file(req, res) {

	var id = req.split[1];
	id = id.substring(0, id.lastIndexOf('.'));

	var arr = id.split('-');

	if (FUNC.checksum(arr[0]) === arr[1])
		res.filefs('files', arr[0]);
	else
		res.throw404();

}

ON('service', function(counter) {

	if (NOW.getHours() === 0 && NOW.getMinutes() === 0) {
		for (var key in MAIN.stats) {
			for (var subkey in MAIN.stats[subkey].today)
				MAIN.stats[key].today[subkey] = 0;
		}
	}

	if (counter % 2 === 0) {
		for (var dbname in MAIN.inmemorydb) {
			var items = MAIN.inmemorydb[dbname];
			for (var key in items) {
				var item = items[key];
				if (item.expire < NOW)
					delete items[key];
			}
		}
	}
});
