FUNC.transationlog = function(query) {
	F.Fs.appendFile(PATH.databases(query.db + '.log'), JSON.stringify(query) + '\n', NOOP);
};

FUNC.checksum = function(id) {
	var sum = 0;
	for (var i = 0; i < id.length; i++)
		sum += id.charCodeAt(i);
	return sum.toString(36);
};

FUNC.preparetokens = function() {
	MAIN.tokens = {};
	if (PREF.tokens) {
		for (var token of PREF.tokens) {

			var obj = CLONE(token);
			if (obj.databases && obj.databases.length) {
				var tmp = {};
				for (var db of obj.databases)
					tmp[db] = 1;
				obj.databases = tmp;
			} else
				obj.databases = null;

			MAIN.tokens[obj.token] = obj;
		}
	}
};

ON('ready', function() {
	PREF.name && LOADCONFIG({ name: PREF.name, allow_tms: PREF.allow_tms, secret_tms: PREF.secret_tms });
	FUNC.preparetokens();
});