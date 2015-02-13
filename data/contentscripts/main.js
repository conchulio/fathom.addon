/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew The main Fathom content script that provides the Fathom API 
 * for web pages through window.fathom object after security checks.
 * 
 * @description The API is implemented completely within the addon, so 
 * this contentscript provides just some shim to wrap the API calls 
 * to async message passing with the core addon.
 *
 * This script is attached via page-mod to pages accessed using 
 * http(s)://, file:// and resource:// protocols.
 *
 * Alternatively the addon pages can include this file directly via
 * a script tag (and the content is loaded as 'trusted').
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

if (typeof addon !== "undefined" || 
    (typeof self !== "undefined" && self.options.enableapi)) 
{
    // The global Fathom object clone in page script context or 
    // the actual object if trusted (this script is loaded in page context)
    var fathom = undefined; 

    // HACKish... make this func global so the api.js can call it.
    var makereq = function() {};

    // hide everything else in this closure
    (function() {
	// TODO: remove the 'trusted script' option ?
	var trusted = (typeof addon !== "undefined");

	// addon or regular web page ?
	var isaddon = (trusted || 
		       (typeof self !== "undefined" && self.options.isaddon));

	var dummyfathom = {
	    about : "Fathom - Browser-based Network Measurements",
	    copyright : "Inria & ICSI, 2014-2015",	
	};

	/* On-going requests and corresponding callbacks. */
	var requests = {};

	/* Running request id. */
	var nextreqid = 1;

	// Message constants
	const REQ = "req";
	const RES = "res";

	/* Make request to the addon. */
	makereq = function(callback, module, method, params, multiresponse) {
	    var req = {};
	    req.module = module;     // fathom.module or init/close
	    req.method = method;     // fathom.module.method
	    req.params = params;     // method params
	    req.multiresp = (multiresponse !== undefined ? 
			     multiresponse : false);
	    req.id = nextreqid;      // unique request id
	    
	    requests[req.id] = { 
		cb : callback,
		req : req
	    };
	    
	    // send msg to the addon
	    if (trusted)
		addon.port.emit(REQ, req);
	    else
		self.port.emit(REQ, req);

	    nextreqid+=1;
	};

	/* Handler for incoming messages from the addon. */
	var handleres = function(res) {
	    if (!res 
		|| !res.id 
		|| !requests[res.id]) 
	    {
		return;
	    }
	    
	    if (requests[res.id].cb!==undefined && 
		typeof requests[res.id].cb === 'function') { 
		if (trusted)
		    requests[res.id].cb.call(null, res.data); 
		else
		    requests[res.id].cb.call(null, 
					     cloneInto(res.data, 
						       unsafeWindow)); 
	    }
	    
	    if (res.done)
		delete requests[res.id];
	};

	if (trusted)
	    addon.port.on(RES, handleres);
	else
	    self.port.on(RES, handleres);

	/* Expose selected modules & methods to the page scripts. */
	var exportapi = function(methods) {

	    var _export = function(module, submodule, func) {
		if (trusted) {
		    // export directly to trusted pages
		    if (!fathom[module])
			fathom[module] = {};

		    if (submodule) {
			if (!fathom[module][submodule])
			    fathom[module][submodule] = {};

			if (func && func !== '*')
			    fathom[module][submodule][func] = fathomapi[module][submodule][func];
			else
			    fathom[module][submodule] = fathomapi[module][submodule];				
		    } else {
			if (func && func !== '*')
			    fathom[module][func] = fathomapi[module][func];
			else
			    fathom[module] = fathomapi[module];
		    }

		} else {
		    // export by cloning
		    if (submodule) {
			// create module object
			if (!fathom[module])
			    fathom[module] = createObjectIn(
				fathom, 
				{defineAs: module});

			if (func && func !== '*') {
			    // create submodule object			    
			    if (!fathom[module][submodule])
				fathom[module][submodule] = createObjectIn(
				    fathom[module], 
				    {defineAs: submodule});
			    
			    exportFunction(fathomapi[module][submodule][func], 
					   fathom[module][submodule], 
					   {defineAs: func});

			} else {
			    fathom[module][submodule] = cloneInto(
				fathomapi[module][submodule], 
				fathom[module],
				{ cloneFunctions: true });	
			}

		    } else {
			if (func && func !== '*') {
			    if (!fathom[module])
				fathom[module] = createObjectIn(
				    fathom, 
				    {defineAs: module});

			    exportFunction(fathomapi[module][func], 
					   fathom[module], 
					   {defineAs: func});

			} else {
			    fathom[module] = cloneInto(
				fathomapi[module], 
				fathom,
				{ cloneFunctions: true });	
			}
		    }
		}
	    }; // export

	    for (var module in fathomapi) {
		if (!methods[module])
		    continue; // not requested

		// check functions and submodules
		for (var submodule in fathomapi[module]) {
		    if (typeof fathomapi[module][submodule] === 'function' && 
			(methods[module]['*'] || methods[module][submodule]) &&
			(isaddon || !fathomapi[module][submodule].addononly)) 
		    {
			// module.[*|function] => selected func
			_export(module, undefined, submodule);
			continue;
		    }

		    if (typeof fathomapi[module][submodule] === 'object' && 
			(methods[module]['*'] || 
			 methods[module][submodule]['*']) && 
			(isaddon || !fathomapi[module][submodule].addononly)) 
		    {
			// requested module.[*|submodule.*] => export all funcs
			_export(module, submodule, undefined);
			continue;
		    }

		    // else check submodule functions
		    for (var func in fathomapi[module][submodule]) {
			if (typeof fathomapi[module][submodule][func] === 'function' && 
			    (methods[module]['*'] || 
			     methods[module][submodule][func]) &&
			    (isaddon || 
			     !fathomapi[module][submodule][func].addononly)) 
			{
			    // module.submodule.function => selected func
			    _export(module, submodule, func);
			    continue;
			}
		    }
		}
	    }
	}; // exportapi

	var handleinit = function(cb) {
	    return function(res) {
		if (res.error) {
		    cb(res);
		} else {
		    // security check ok, attach validated API methods and 
		    // return control to the page script
		    exportapi(res.manifest.api);
		    cb(true);
		}
	    };
	};

	if (!trusted) {
	    if (!isaddon) {
		// init for regular web pages
		dummyfathom.init = function(callback, manifest) {
		    if (!manifest || 
			(manifest.api===undefined || 
			 manifest.destinations===undefined)) 
		    {
			callback({error : "missing or invalid manifest"});
			return;
		    }

		    if (nextreqid>1) {
			// re-calling init, cleanup previous state
			makereq(undefined, 'internal', 'close', undefined);
			// reset exposed api
			fathom = cloneInto(dummyfathom, unsafeWindow,
					   { cloneFunctions: true });
			unsafeWindow.fathom = fathom;
		    }
		    nextreqid = 1;

		    // webpages cannot tamper with this value so safe to use
		    // used in manifest destination checks
		    manifest.location = window.location;
		    manifest.isaddon = false;
		    makereq(handleinit(callback), 'internal', 'init', manifest);
		};
	    } else {	
		// simplified init for addon pages
		dummyfathom.init = function(callback) {
		    var manifest = {
			description : "Fathom Tools",
			api : [],
			destinations : [],
			location : window.location,
			isaddon : true
		    };
		    for (var api in fathomapi) {
			manifest.api.push(api+".*");
		    }
		    makereq(handleinit(callback), 'internal', 'init', manifest);
		};

		// expose the internal API directly to the addon pages
		dummyfathom.internal = function(callback, method, params) {
		    makereq(callback, 'internal', method, params);
		}

		// shortcut for uploads
		dummyfathom.uploaddata = function(src, data) {
		    makereq(undefined, 'internal', 'upload', data);
		};
	    }

	    dummyfathom.close = function() {
		makereq(undefined, 'internal', 'close', undefined);
	    };

	    // create initial Fathom object and expose it to page script(s)
	    fathom = cloneInto(dummyfathom, unsafeWindow,
			       { cloneFunctions: true });
	    unsafeWindow.fathom = fathom;

	} else {
	    // simplified init for trusted addon pages
	    dummyfathom.init = function(callback) {
		var manifest = {
		    description : 'Fathom Tools',
		    api : [],
		    destinations : [],
		    location : window.location,
		    isaddon : true
		};
		for (var api in fathomapi) {
		    manifest.api.push(api+".*");
		}
		makereq(handleinit(callback), 'internal', 'init', manifest);
	    };

	    // expose the internal API directly to the addon pages
	    dummyfathom.internal = function(callback, method, params) {
		makereq(callback, 'internal', method, params);
	    };

	    // shortcut for uploads
	    dummyfathom.uploaddata = function(data) {
		makereq(undefined, 'internal', 'upload', data);
	    };

	    dummyfathom.close = function() {
		makereq(undefined, 'internal', 'close', undefined);
	    };

	    // expose directly via the window
	    window.fathom = fathom = dummyfathom;
	}
    }()); // init closure
} // disabled