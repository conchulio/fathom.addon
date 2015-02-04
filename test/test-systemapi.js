const config = require("./config");
const systemapi = require("./systemapi");
const system = require("sdk/system");
const _ = require('underscore');

systemapi.setup();

exports["testerror"] = function(assert, done) {
    systemapi.exec(function(res) {
	assert.ok(res.error !== undefined, 
		  "unknown method returns error");
	assert.ok(res.error.type === "nosuchmethod", 
		  "unknown method returns correct error");
	done();
    }, { method : 'foo'});
};

exports["testpinglocal"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log("test doPing",res);
	assert.ok(!res.error, "doPing no error");
	assert.ok(res.result.count === 1, "doPing count");
	assert.ok(res.result.rtt.length === 1, "doPing results");
	done();
    }, { method : 'doPing', params: ['localhost', { count : 1 }]});
};

exports["testpingbcast"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log("test doPing",res);
	assert.ok(!res.error, "doPing no error");
	if (doneflag)
	    done();
    }, { method : 'doPing', 
	 params: ['192.168.1.255', { count : 1, interval : 5, bcast : true }]});
};


exports["testpingerror"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	assert.ok(res.error, "doPing got error");
	assert.ok(res.error.type === "missingparams", 
		  "doPing got correct error");
	done();
    }, { method : 'doPing', params: []});
};

exports["testpingttl"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log("test doPing with ttl",res);
	assert.ok(!res.error, "doPing no error");
	assert.ok(res.result.count === 1, "doPing count == 1");
	assert.ok(res.result.time_exceeded_from, 
		  "doPing got time exceeded from " + 
		  res.result.time_exceeded_from);
	done();
    }, { method : 'doPing', params: [config.MSERVER_FR, 
				     { count : 1, ttl : 1, timeout : 1 }]});
};

exports["testtraceroute"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log("test doTraceroute",res);
	assert.ok(!res.error, "doTraceroute no error");
	assert.ok(res.result.hops[0], "doTraceroute got results");
	assert.ok(res.result.hops[0].address == '127.0.0.1', 
		  "doTraceroute results valid");
	done();
    }, { method : 'doTraceroute', params: ['localhost']});
};

exports["testtraceroutelong"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log("test doTraceroute",res);
	assert.ok(!res.error, "doTraceroute no error");
	assert.ok(res.result.hops.length>0, "doTraceroute got results");
	done();
    }, { method : 'doTraceroute', params: ['www.google.com', {
	count : 1, waittime : 1
    }]});
};

exports["testgetos"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	assert.ok(res === require('sdk/system').platform, 
		  "getOS: " + res);
	done();
    }, { method : 'getOS', params: []});
};

exports["testgethostname"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	assert.ok(!res.error && res.result, "getHostname: " + res.result);
	done();
    }, { method : 'getHostname'});
};

exports["testgetarp"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log(res);
	assert.ok(!res.error, "getArp no error");
	assert.ok(_.keys(res.result).length>0, "getArp has results");
	done();
    }, { method : 'getArpCache'});
};

exports["testgetroute"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log(res);
	assert.ok(!res.error, "getRoutingTable no error");
	assert.ok(!_.isEmpty(res.result.routes), "getRoutingTable has results");
	assert.ok(res.result.defaultroute, 
		  "getRoutingTable found default route");
	done();
    }, { method : 'getRoutingTable'});
};

exports["testgetns"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log(res);
	assert.ok(!res.error, "getNameservers no error");
	assert.ok(res.result.nameservers.length > 0, "getNameservers got results");
	done();
    }, { method : 'getNameservers'});
};

exports["testgetifaces"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log(res);
	assert.ok(!res.error, "getActiveInterfaces no error");
	assert.ok(_.keys(res.result).length>0, "getActiveInterfaces found some interfaces");
	done();
    }, { method : 'getActiveInterfaces'});
};

exports["testifacestats"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log(res);
	assert.ok(!res.error, "getIfaceStats no error");
	assert.ok(_.keys(res.result).length>0, "getIfaceStats found some interfaces");
	done();
    }, { method : 'getIfaceStats'});
};

exports["testgetwifi"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log(res);
	if (!res.error && res.result.bssid) {
	    assert.ok(res.result.bssid,"getActiveWifiInterface bssid " + res.result.bssid);
	    
	    systemapi.exec(function(res2, doneflag) {
		console.log(res2);
		assert.ok(!res2.error, "getWifiSignal no error");
		assert.ok(res2.result.signal,"getWifiSignal " + res2.result.signal);

		systemapi.exec(function(res3, doneflag) {
		    console.log(res3);
		    assert.ok(!res3.error, "getWifiNetworks no error");
		    assert.ok(res3.result.length > 0,"getWifiNetworks found networks");
		    done();
		    
		}, { method : 'getWifiNetworks'});
		
	    }, { method : 'getWifiSignal'});
	    
	} else {
	    assert.ok(res!==undefined, "getActiveWifiInterface no wifi or offline");
	    done();
	}
    }, { method : 'getActiveWifiInterface'});
};

exports["testmem"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log(res);
	if (system.platform !== 'darwin') {
	    assert.ok(!res.error && res.result.memfree > 0, "getMemInfo");
	} else {
	    assert.ok(res.error, "getMemInfo");
	}
	done();
    }, { method : 'getMemInfo'});
};

exports["testload"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log(res);
	assert.ok(!res.error, "getLoad no error");
	assert.ok(res.result.tasks.total > 0, "getLoad found tasks");
	assert.ok(res.result.loadavg.onemin > 0, "getLoad found loadavg");
	assert.ok(res.result.cpu.user > 0, "getLoad found cpu");
	assert.ok(res.result.memory.total > 0, "getLoad found memory");
	done();
    }, { method : 'getLoad'});
};

exports["testbmem"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log(res);
	assert.ok(!res.error, "getBrowserMemoryUsage no error");
	assert.ok(res.result.mem > 0, "getBrowserMemoryUsage got result");
	done();
    }, { method : 'getBrowserMemoryUsage'});
};

exports["testproxy"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
	console.log(res);
	assert.ok(!res.error, "getProxy no error");
	done();
    }, { method : 'getProxyInfo', params : [config.API_URL]});
};

exports["testpromise"] = function(assert, done) {
    const { all } = require('sdk/core/promise');
    all([
	systemapi.execp({ method : 'getBrowserMemoryUsage'}),
	systemapi.execp({ method : 'getLoad'}),
	systemapi.execp({ method : 'getNameservers'}),
    ]).then(function (results) {
	// success function
	console.log(JSON.stringify(results, null, 4));
	assert.ok(results.length == 3, "got all results");
	done();
    }, function (reason) {
	assert.ok(reason, "error " + reason);
	done();
    });
};

require("sdk/test").run(exports);
