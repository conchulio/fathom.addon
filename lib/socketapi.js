/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew The implementation of fathom.socket.* & fathom.tools.* APIs.
 *
 * We use the NSPR library and worker threads to provide an asynchronous acces
 * socket APIs. This module takes care of creating and messaging with
 * the ChromeWorkers. The actual API implementation is in the worker code
 * at ./data/workerscripts/*.js.
 *
 * Note that the add-on sdk adds another layer of async callbacks compared 
 * to the previous implementation (from the content script to addon an
 * from the addon to the worker).
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

const { Unknown } = require('sdk/platform/xpcom');
const {Cc, Ci, Cu} = require("chrome");
const {ChromeWorker} = Cu.import("resource://gre/modules/Services.jsm", null);

const self = require("sdk/self");
const timers = require("sdk/timers");

const {error, FathomException} = require("error");
const security = require('security');

// id and cache of async API socket workers
var socketid = 1;
var socketworkers = {}; // socketid -> workerstruct
var nsprfile = require('utils').nsprFile;

/**
 * Cleanup the API component when the addon is unloaded.
 */
var stop = exports.stop = function() {
    console.info("socketapi stop");
    var sw;
    for (var s in socketworkers) {	
	sw = socketworkers[s];
	sw.worker.postMessage(JSON.stringify({ method : 'close' }));
    }
    socketworkers = {};
};

// worker error
var geterrorhandler = function(sid) {
    return function(event) {
	var msg = "socketapi [worker"+sid+"] error: " + event.message + 
	    ' [' + event.filename + ':' + event.lineno + ']';
	console.error(msg);
    };
};

// worker message
var getmessagehandler = function(sid) {
    return function(event) {
	var msg = undefined, sw = undefined;
	if (!event.data) {
	    console.warn("socketapi [worker"+sid+"] sends empty message?!?");
	    return;
	}

	console.debug("socketapi [worker"+sid+"] got message: " + 
		     (event.data.length > 50 ? 
		      event.data.substring(0,50) + " ... }" : event.data));

	msg = JSON.parse(event.data);
	sw = socketworkers[sid];
	if (!sw) {
	    // can happen for example when recv loop is stopping ..
	    return;
	}

	if (msg.data && msg.data.error)
	    console.warn("socketapi [worker"+sid+"] req "+msg.id+" error: "+
			 msg.data.error);

	if (sw.requests[msg.id]) {
	    if (!sw.init && !msg.data.error) {
		// reply to open request
		sw.requests[msg.id](sid, msg.done);
		sw.init = true;
	    } else if (msg.data.error) {
		sw.requests[msg.id](error("socketerror",msg.data.error), 
				    msg.done);
	    } else {
		sw.requests[msg.id](msg.data, msg.done);
	    }
	    if (msg.done)
		delete sw.requests[msg.id];
	} else {
	    console.warn("socketapi [worker"+sid+"] request "+ 
			 msg.id + " has no callback?!");
	}
    };
};

/**
 * Cleanup executing sockets for the given window.
 */
var windowclose = exports.windowclose = function(winid) {
    var sw;
    var del = [];
    for (var s in socketworkers) {	
	sw = socketworkers[s];
	if (sw.winid === winid) {
	    sw.worker.postMessage(JSON.stringify({ method : 'close' }));
	    del.push(s);
	}
    }
    for (var s in del)
	delete socketworkers[s];
};

/**
 * Executes the given socket request and calls back with the data or 
 * an object with error field with a short error message.
 */ 
var exec = exports.exec = function(callback, req, manifest) {
    if (!req.method)
	return callback(error("missingmethod"));

    // TODO: params array could really be an object (and check for 
    // req.params.ip) so we don't need to know the index for each 
    // method here... this is rather ugly like this
    // Other option is to put the check to the chromeworker code where
    // we have the names of the operations, but that adds the
    // overhead of messaging with the chromeworker ...
    var checkok = undefined;
    var dst = {
	host : undefined,
	port : undefined,
	proto : req.submodule,
    };
    switch (req.method) {
    case "udpSendTo":
	if (!req.params || req.params.length < 3 || !req.params[2])
	    return callback(error("missingparams","host"));
	if (!req.params || req.params.length < 4 || !req.params[3])
	    return callback(error("missingparams","port"));

	dst.host = req.params[2];
	dst.port = req.params[3];
	checkok = security.checkDstPermission(dst, manifest);
	break;
    case "udpConnect":
    case "multicastJoin":
	if (!req.params || req.params.length < 2 || !req.params[1])
	    return callback(error("missingparams","host"));
	if (!req.params || req.params.length < 3 || !req.params[2])
	    return callback(error("missingparams","port"));

	dst.host = req.params[1];
	dst.port = req.params[2];
	checkok = security.checkDstPermission(dst, manifest);
	break;
    case "tcpOpenSendSocket":
	if (!req.params || req.params.length < 1 || !req.params[0])
	    return callback(error("missingparams","host"));
	if (!req.params || req.params.length < 2 || !req.params[1])
	    return callback(error("missingparams","port"));

	dst.host = req.params[0];
	dst.port = req.params[1];
	checkok = security.checkDstPermission(dst, manifest);
	break;
    case "start":
	if (req.submodule === 'ping' && 
	    req.params[0] && req.params[0].client) {
	    // tools.ping.start
	    dst.host = req.params[0].client;
	    dst.port = req.params[0].port || 5790;
	    dst.proto = req.params[0].proto || 'udp';
	    checkok = security.checkDstPermission(dst, manifest);
	} else if (req.submodule === 'iperf' && 
		   req.params[0] && req.params[0].client) {
	    // tools.iperf.start
	    dst.host = req.params[0].client;
	    dst.port = req.params[0].port || 5791;
	    dst.proto = req.params[0].proto || 'udp';
	    checkok = security.checkDstPermission(dst, manifest);
	} else {
	    // else tools.*.start server
	    checkok = true;
	}
	break;
    default:
	// nothing to check for other methods
	checkok = true;
    }
    console.debug("socketapi securitycheck="+checkok);

    if (!checkok) {
	return callback(error("destinationnotallowed", 
			      dst.proto+"://"+dst.host+":"+dst.port));
    }

    if (dst.host) {
	// check the server manifest
	if (!security.checkDstServerPermission(dst, manifest))
	    return callback(error("serverforbidden",dst.host));
    }

    var sid = undefined, worker = undefined, sw = undefined;    
    if (req.method.toLowerCase().indexOf('open')>=0 || 
	(req.module === "tools" && req.method === "start")) 
    {
	// creating new socket and associated worker
	sid = socketid;
	socketid = socketid + 1;
	console.debug("socketapi create [worker" + sid + "] exec req " + 
		     req.id + " method '" + req.method+"' cont=" + 
		     req.multiresp);

	var scriptname = self.data.url("workerscripts/socketworker.js");
	worker = new ChromeWorker(scriptname);
	worker.onerror = geterrorhandler(sid);
	worker.onmessage = getmessagehandler(sid);

	sw = {
	    init : false,
	    winid : manifest.winid, // for handling window close events
	    worker : worker,
	    requests : {},     // request callback cache
	};
	socketworkers[sid] = sw;

	// add few fields for initializing the socket worker
	req.createworker = true;
	req.nsprpath = nsprfile.path;
	req.nsprname = nsprfile.leafName;
	req.workerid = sid;

	// send open request to the worker
	sw.requests[req.id] = callback;
	sw.worker.postMessage(JSON.stringify(req));

    } else if (req.params && req.params.length>0) { 
	sid = req.params[0];
	console.debug("socketapi [worker" + sid + "] exec req " + req.id + 
		    " method '" + req.method+"' cont=" + req.multiresp);

	sw = socketworkers[sid];
	if (!sw)
	    return callback(error("invalidid", "socket="+sid));

	if (req.method === 'close' || req.method === 'stop') {
	    sw.worker.postMessage(JSON.stringify(req));
	    delete socketworkers[sid];
	    callback({},true);

	} else if (sw.requests[req.id]===undefined) {
	    // async callback
	    req.params = req.params.slice(1);
	    sw.requests[req.id] = callback;
	    sw.worker.postMessage(JSON.stringify(req));

	} else {
	    // reusing same req id ?!
	    return callback(error("invalidparams",
				  "duplicate request_id="+req.id));
	}
    } else {
	// socket API call for existing worker, but no socketid parameter
	return callback(error("missingparams","socketid"));
    }
};