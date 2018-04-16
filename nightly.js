var NOW = new Date();
var FTP_DIR = '/' + NOW.getFullYear() + '/' + (NOW.getMonth() + 101).toString().slice(1);
var FTP_BASE = 'https://ftp.mozilla.org/pub/mobile/nightly' + FTP_DIR + '/';
var DIR_RE = /((\d\d\d\d-\d\d-\d\d-\d\d-\d\d-\d\d)-mozilla-central-android-api-16\/)">/g;
var SPEC_RE = /(fennec-.*?\.multi\.android-arm\.txt)">/;
var CHANGESET_RE = /\/rev\/(\w+)/;
var CHANGES_RE = /<\/th><\/tr>\r?\n([\w\W]+)\r?\n<\/table>/;
var HG_LOG = 'https://hg.mozilla.org/mozilla-central/pushloghtml';
var HG_BASE = 'https://hg.mozilla.org';
var COLLAPSEID_RE = /id(\d+)/;
var BUGZILLA_RE = /^https:\/\/bugzilla\.mozilla\.org\/show_bug\.cgi\?id=(\d+)$/;
var BUGZILLA_SEARCH = 'https://bugzilla.mozilla.org/rest/bug?include_fields=id,summary,product,component';

document.addEventListener('DOMContentLoaded', function () {
	var container = document.createElement('ol');
	container.id = 'builds';
	Build.findBuilds(container);
	document.body.appendChild(container);
});

var Bugzilla = {};

Bugzilla.cache = {};

Bugzilla.dest = {};

Bugzilla.queue = [];

Bugzilla.pending = null;

Bugzilla.request = function (link, id) {
	if (id in Bugzilla.cache) return Bugzilla.setFields(link, Bugzilla.cache[id]);
	if (id in Bugzilla.dest) return Bugzilla.dest[id].push(link);
	Bugzilla.dest[id] = [link];
	Bugzilla.queue.push(id);
	Bugzilla.bumpNetwork();
};

Bugzilla.bumpNetwork = function () {
	if (Bugzilla.pending) return;
	if (!Bugzilla.queue.length) return;
	Bugzilla.pending = Bugzilla.queue.splice(0, 100);
	var ids = Bugzilla.pending.join(',');
	var xhr = new XMLHttpRequest();
	xhr.open('GET', BUGZILLA_SEARCH + '&id=' + ids);
	xhr.setRequestHeader('Accept', 'text/json');
	xhr.responseType = 'json';
	xhr.addEventListener('load', function () {
		var denied = new Set(Bugzilla.pending);
		var bugs = xhr.response.bugs; // lol ie
		for (var bug of bugs) {
			denied.delete(bug.id);
			Bugzilla.receive(bug.id, bug);
		}
		for (var id of denied) {
			Bugzilla.receive(id, null);
		}
		Bugzilla.pending = null;
		Bugzilla.bumpNetwork();
	});
	xhr.send(null);
};

Bugzilla.receive = function (id, bug) {
	Bugzilla.cache[id] = bug;
	if (!(id in Bugzilla.dest)) return;
	var links = Bugzilla.dest[id];
	delete Bugzilla.dest[id];
	if (!links.length) return;
	for (var link of links) {
		Bugzilla.setFields(link, bug);
	}
};

Bugzilla.setFields = function (link, bug) {
	if (bug) {
		link.className = 'bug-deco';
		link.title = bug.summary;
		link.dataset.product = bug.product;
		link.dataset.component = bug.component;
	} else {
		link.className = 'bug-unknown';
	}
};

function Build(dir, date) {
	this.prev = null;
	this.next = null;

	this.dir = dir;
	this.spec = null;
	this.changeset = null;

	var dateDisplay = document.createElement('h2');
	dateDisplay.textContent = date;
	this.changesDisplay = null;
	this.view = document.createElement('li');
	this.view.className = 'build';
	this.view.appendChild(dateDisplay);
}

Build.findBuilds = function (container) {
	// TODO: start global loading indicator
	Build.getURL(FTP_BASE, function (h) {
		var tail = null, m, build;
		while (m = DIR_RE.exec(h)) {
			build = new Build(m[1], m[2]);
			if (tail) tail.append(build);
			tail = build;
		}
		for (var build = tail; build; build = build.prev) {
			container.appendChild(build.view);
			build.load();
		}
		// TODO: stop global loading indicator
	});
};

Build.getURL = function (url, callback) {
	var xhr = new XMLHttpRequest();
	xhr.open('GET', url);
	xhr.responseType = 'text';
	xhr.addEventListener('load', function () {
		callback(xhr.response);
	});
	xhr.send(null);
};

Build.processLinks = function (table) {
	var links = table.getElementsByTagName('a');
	for (var i = 0; i < links.length; i++) {
		var link = links[i];
		var href = link.getAttribute('href');
		Build.fixRelativeLink(link, href);
		Build.addBugProps(link, href);
	}
};

Build.fixRelativeLink = function (link, href) {
	if (href[0] != '/') return;
	link.href = HG_BASE + href;
};

Build.addBugProps = function (link, href) {
	var m = BUGZILLA_RE.exec(href);
	if (!m) return;
	var id = m[1];
	Bugzilla.request(link, id);
};

Build.collapseHiddenChanges = function (table) {
	var toggles = table.getElementsByClassName('expand');
	for (var i = 0; i < toggles.length; i++) {
		var toggle = toggles[i];
		var m = COLLAPSEID_RE.exec(toggle.className);
		if (!m) continue; // wut
		var id = m[1];
		var changes = table.getElementsByClassName('hidden id' + id);
		Build.collapseChangesById(id, toggle, changes);
	}
};

Build.collapseChangesById = function (id, toggle, changes) {
	var collapsed = false;
	toggle.addEventListener('click', function (e) {
		var text = collapsed ? '[Collapse]' : '[Expand]';
		collapsed = !collapsed;
		var visibility = collapsed ? 'collapse' : '';
		toggle.textContent = text;
		for (var i = 0; i < changes.length; i++) {
			changes[i].style.visibility = visibility;
		}
		e.preventDefault();
	});
};

Build.prototype.debugLink = function (url) { // %%%
	var a = document.createElement('a');
	a.href = url;
	a.textContent = url;
	this.view.appendChild(a);
};

Build.prototype.append = function (next) {
	this.next = next;
	next.prev = this;
};

Build.prototype.remove = function () {
	if (this.prev) this.prev.next = this.next;
	if (this.next) this.next.prev = this.prev;
	this.view.parentNode.removeChild(this.view);
	if (this.prev && this.prev.changeset && this.next && this.next.changeset) this.next.findChanges();
};

Build.prototype.load = function () {
	// TODO: start loading indicator
	this.findSpec();
};

Build.prototype.findSpec = function () {
	var build = this;
	Build.getURL(FTP_BASE + this.dir, function (h) {
		var m = SPEC_RE.exec(h);
		if (!m) return build.remove();
		build.spec = m[1];
		build.findChangeset();
	});
};

Build.prototype.findChangeset = function () {
	var build = this;
	Build.getURL(FTP_BASE + this.dir + this.spec, function (t) {
		var m = CHANGESET_RE.exec(t);
		if (!m) return build.remove();
		build.setChangeset(m[1]);
	});
};

Build.prototype.setChangeset = function (changeset) {
	this.changeset = changeset;
	if (this.prev && this.prev.changeset) this.findChanges();
	if (this.next && this.next.changeset) this.next.findChanges();
};

Build.prototype.findChanges = function () {
	var build = this;
	Build.getURL(HG_LOG + '?fromchange=' + this.prev.changeset + '&tochange=' + this.changeset, function (h) {
		if (!h) return build.setChangesError();
		var m = CHANGES_RE.exec(h);
		if (!m) return build.setNoChanges();
		build.setChanges(m[1]);
	});
};

Build.prototype.setChangesError = function () {
	this.changesDisplay = document.createElement('p');
	this.changesDisplay.className = 'changes-error'; // TODO: implement
	this.view.appendChild(this.changesDisplay);
	this.complete();
};

Build.prototype.setNoChanges = function () {
	this.changesDisplay = document.createElement('p');
	this.changesDisplay.className = 'no-changes'; // TODO: implement
	this.view.appendChild(this.changesDisplay);
	this.complete();
};

Build.prototype.setChanges = function (changes) {
	var div = document.createElement('div');
	div.innerHTML = '<table>' + changes + '</table>';
	this.changesDisplay = div.firstChild;
	Build.processLinks(this.changesDisplay);
	Build.collapseHiddenChanges(this.changesDisplay);
	this.view.appendChild(this.changesDisplay);
	this.complete();
};

Build.prototype.complete = function () {
	// TODO: stop loading indicator
};
