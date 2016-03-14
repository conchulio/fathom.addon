/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew System command output to JSON parser.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
const system = require("sdk/system");
const os = system.platform;

const winnt = "winnt";
const android = "android";
const linux = "linux";
const darwin = "darwin";

const _ = require('underscore');

const {error, FathomException} = require("./error");
const consts = require('./consts');
   
// min/max/mean/median/std_dev/variance of an array or null if x is empty
// or just a single value
var describe = function(x) {    
    if (!x || x.length <= 1) return null;

    var res = {};
    var s = 0;
    for (let i = 0; i < x.length; i++) {
        if (x[i] < res.min || res.min === undefined) res.min = x[i];
        if (x[i] > res.max || res.max === undefined) res.max = x[i];
        s += x[i];
    }
    res.mean = s / x.length;

    var sumdev = 0;
    for (let i = 0; i < x.length; i++) {
        sumdev += (Math.pow(x[i] - res.mean, 2));
    }
    res.variance = sumdev / x.length;
    res.std_dev = Math.sqrt(res.variance);

    var sorted = x.slice().sort(function (a, b) { return a-b; });
    if (sorted.length % 2 === 1) {
        res.median = sorted[(sorted.length - 1) / 2];
    } else {
        var a = sorted[(sorted.length / 2) - 1];
        var b = sorted[(sorted.length / 2)];
        res.median = (a + b) / 2;
    } 
    return res;
}

//--------------------------------
// parsers per cmd line tool

var parserfuncs = {};

// -- configurations --

parserfuncs["hostname"] = function(out, args, params) {
    return out;
};

parserfuncs["getprop"] = function(out, args, params) {
    if (os === android)
        return out;
    else
        throw new Error("syscmdparser 'getprop' not available on '" + os + "'");
};

parserfuncs["vm_stat"] = function(out, args, params) {
    if (os !== darwin)
        throw new Error("syscmdparser 'vm_stat' not available on '" + os + "'");
    
    var lines = out.split("\n");
    var line = lines[0].trim().replace(/\s+/g, ' ').split(' ');
    var res = {
        pagesize : parseInt(line[7])
    }

    for (let i = 1; i < lines.length; i++) {
        line = lines[i].trim().replace(/\s+/g, ' ').split(': ');
        let key = line[0].replace(/"/gi,'').replace(/ /gi,'_').toLowerCase();
        res[key] = parseInt(line[1].replace(/\./gi,''));
    }
    return res;
};

parserfuncs["cat"] = function(out, args, params) {
    function ip4(val) {
        var addr = [];
        var tmp = (val & 0xFF);
        if (tmp < 0) 
            tmp = tmp & 0xFF + 1;
        var t = addr.push(tmp);
        tmp = (val & 0xFF00) >> 8;
        if (tmp < 0) 
            tmp = tmp & 0xFFFF + 1;
        t = addr.push(tmp);
        tmp = (val & 0xFF0000) >> 16;
        if (tmp < 0) 
            tmp = tmp & 0xFFFFFF + 1;
        t = addr.push(tmp);
        tmp = (val & 0xFF000000) >> 24;
        if (tmp < 0) 
            tmp = tmp & 0xFFFFFFFF + 1;
        t = addr.push(tmp);
        return addr.join(".");
    }

    var res = undefined;
    var lines = out.split("\n");
    var line, i,g,h;

    switch (args[0]) {
    case "/etc/resolv.conf":
        res = { nameservers : []};
        for (i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("#") === 0 || lines[i].length <= 0) {
                continue;
            }

            line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            if (line[0] == "domain") {
                res.domain = line.splice(1);
            } else if (line[0] == "search") { 
                res.search = line.splice(1);
            } else if (line[0] == "nameserver") {
                res.nameservers.push(line[1]);
            }
        }
        break;
    
    case "/proc/net/route":
        res = [];
        h = lines[0].toLowerCase().trim().replace(/\s+/g, ' ').split(' ');
        for (i = 1; i < lines.length; i++) {
            line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            let o = {};
            _.each(h, function(key,idx) {
                switch(key) {
                case 'destination':
                case 'gateway':
                case 'mask':
                    o[key] = ip4(parseInt(line[idx],16));
                    break;
                case 'iface':
                case 'flags':
                    o[key] = line[idx];
                    break;
                default:
                    o[key] = parseInt(line[idx]);
                }
            });
            o.defaultroute = (o.destination === '0.0.0.0' || o.destination === 'default');
            res.push(o);
        }
        break;

    case "/proc/net/wireless":
        // TODO: fails if we have multiple wireless interfaces ..
        res = {};
        for (i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("|") >= 0 || lines[i].length <= 0) {
                continue;
            }
            
            line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            res = {
                name : line[0].replace(/:/,''),
                link : parseInt(line[2]),
                signal : parseInt(line[3]),
                noise : parseInt(line[4]),
            };
        }
        break;
    
    case "/proc/net/dev":
        res = [];
        for (i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("|") >= 0 || lines[i].length <= 0) {
                continue;       
            }

            line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            res.push({
                name : line[0].replace(/:/gi,''),
                rx : {
                    bytes : parseInt(line[1]),
                    packets : parseInt(line[2]), 
                    errs : parseInt(line[3]),
                    drop : parseInt(line[4])
                },
                tx : {
                    bytes : parseInt(line[9]),
                    packets : parseInt(line[10]), 
                    errs : parseInt(line[11]),
                    drop : parseInt(line[12]) 
                }
            });
        }
        break;

    case "/proc/meminfo":
    case "/proc/net/snmp6":
        res = {};
        for (i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("#") === 0 || lines[i].length <= 0) {
                continue;
            }

            line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            res[line[0].replace(/:/gi,'').toLowerCase()] = parseInt(line[1]);

            if (line.length === 3)
                res.unit = line[2];
        }
        break;
    
    case "/proc/net/netstat":
    case "/proc/net/snmp":
        res = {};
        g = undefined;
        h = undefined;
        for (i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("#") === 0 || lines[i].length <= 0) {
                continue;       
            }

            line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            if (!g || g !== line[0]) {
                // header line
                g = line[0];
                h = line.splice(1);
            } else {
                // value line
                g = g.replace(/:/gi,'').toLowerCase();
                res[g] = {}
                _.each(h, function(key,idx) {
                    res[g][key.toLowerCase()] = parseInt(line[idx+1]);
                });
                g = undefined;
            }
        }
        break;

    case "/proc/net/tcp":
    case "/proc/net/tcp6":
    case "/proc/net/udp":
    case "/proc/net/udp6":
    default:
        throw new Error("syscmdparser does not support 'cat " + args[0] + "'");
    }

    return res;
};

parserfuncs["ifconfig"] = function(out, args, params) {
    var res = [];
    
    switch (os) {
    case linux:
        var ifaces = out.split("\n\n");
        for (var i = 0; i < ifaces.length; i++) {
            var str = ifaces[i].trim().replace(/\s+/g, ' ');
            if (!str) {
                continue;
            }

            var iface = {};

            var attrs = {
                'name': /^([\w\d]+) /gi,
                'type': /encap:(\w+) /gi,
                'mac': /hwaddr ([\w:\d]+) /gi,
                'ipv4': /inet addr:([\.\d]+) /gi,
                'ipv6': /inet6 addr: ([\:\d\w]+\/\d+) /gi,
                'broadcast': /bcast:([\.\d]+) /gi,
                'mask': /mask:([\.\d]+) /gi,
                'mtu': /mtu:(\d+) /gi,
                'txqueuelen': /txqueuelen:(\d+) /gi
            };

            _.each(attrs, function(value, key) {
                var m = null;
                while ((m = value.exec(str)) !== null) {
                    if (key === 'mtu' || key === 'txqueuelen')
                        iface[key] = parseInt(m[1]);
                    else if (key === 'type')
                        iface[key] = m[1].toLowerCase();
                    else if (key === 'ipv6')
                        iface[key] = m[1].split('\/')[0];
                    else
                        iface[key] = m[1];
                }
            });

            if (iface.type === 'local') {
                iface.type = 'loopback';
            }

            if (params && params[0]!==undefined) {
                // active filtering ?
                if (params[0] && (iface.ipv4 || iface.ipv6)) {
                    res.push(iface);    
                } else if (!params[0]) {
                    res.push(iface); 
                }
            } else {
                res.push(iface);
            }
        }
        break;

    case darwin:
        var lines = out.split("\n");

        // group by name -> string
        var tmp = {};
        var name = undefined;
        var re = /^([\w\d]+): flags/;
        for (var i = 0; i < lines.length; i++) {
            var m = re.exec(lines[i]);
            if (m) {
                name = m[1];
                tmp[name] = lines[i].slice(lines[i].indexOf(':')+1).trim() + ' ';
            } else {
                tmp[name] += lines[i].trim() + ' ';
            }
        }

        // parse each iface
        _.each(tmp, function(str, name) {
            var iface = { name : name};

            var attrs = {
                'mtu': /mtu (\d+)/gi,
                'ipv6': /inet6 ([\:\d\w\%]+)/gi,
                'ipv4': /inet ([\.\d]+)/gi,
                'mask': /netmask 0x([\d\w]+)/gi,
                'broadcast': /broadcast ([\.\d]+)/gi,
                'mac': /ether ([\w:\d]+)/gi,
                'status': /status: (\w+)/gi
            };

            // remove any extra whitespace
            str = str.replace(/\s+/g, ' ');

            // match attrs
            _.each(attrs, function(value, key) {
                var m = null;
                while ((m = value.exec(str)) !== null) {
                    if (key === 'mtu') {
                        iface[key] = parseInt(m[1]);
                    } else if (key === 'mask') {
                        // hex mask, convert to ip
                        var tmp = [];
                        for (var j = 0; j < 8; j+=2) {
                            tmp.push(parseInt('0x' + m[1].substring(j,j+2)));
                        }
                        iface[key] = tmp.join('.');
                    } else if (!iface[key]) {
                        iface[key] = m[1];
                    }
                }
            });

            if (iface.type === 'local') {
                iface.type = 'loopback';
            }

            if (params && params[0]!==undefined) {
                // active filtering ?
                if (params[0] && (iface.ipv4 || iface.ipv6 || iface.status === 'active')) {
                    res.push(iface);
                } else if (!params[0]) {
                    res.push(iface);                    
                }
            } else {
                res.push(iface);
            }
        });
        break;

    default:
        throw new Error("syscmdparser 'ifconfig' not available on '" + os + "'");
    }

    return res;
};

parserfuncs["netsh"] = function(out, args, params) {
    if (os !== winnt) {
        throw new Error("syscmdparser 'netsh' not available on '" + os + "'");    
    }

    var res;
    if (args[0] === 'wlan') {
        // FIXME: should really return a list of interfaces (can happen that we have more than 1)
        res = {};
        switch (args[args.length-1]) {
        case 'interface':
            // netsh wlan show interface
            res.connected = false;
            res.offline = true;

            var lines = out.split("\n");
            for (var i = 0; i < lines.length; i++) {
                var l = lines[i].trim().replace(/\s+/g, ' ');
                if (!l || l.length<=0) {
                    continue;
                }

                var elems = l.split(' : ');
                if (!elems || elems.length !== 2) {
                    continue;
                }

                if (elems[0] === 'name') {
                    res['name'] = elems[1];
                } else if (elems[0] === 'Description') {
                    res['desc'] = elems[1];
                } else if (elems[0] === 'Physical address') {
                    res['mac'] = elems[1];
                } else if (elems[0] === 'State' && elems[1] === 'connected') {
                    res.connected = true;
                    res.offline = false;
                } else if (elems[0] === 'SSID') {
                    res['ssid'] = elems[1];
                } else if (elems[0] === 'BSSID') {
                    res['bssid'] = elems[1];
                } else if (elems[0] === 'Network type') {
                    res['mode'] = elems[1].toLowerCase();
                } else if (elems[0] === 'Radio type') {
                    res['version'] = elems[1];
                } else if (elems[0] === 'Authentication') {
                    res['auth'] = elems[1];
                } else if (elems[0] === 'Channel') {
                    res['channel'] = parseInt(elems[1]);
                } else if (elems[0].indexOf('Receive rate')>=0) {
                    res['rxrate'] = parseFloat(elems[1]);
                } else if (elems[0].indexOf('Transmit rate')>=0) {
                    res['txrate'] = parseFloat(elems[1]);
                } else if (elems[0] == 'Signal') {
                    res['quality'] = parseFloat(elems[1].replace(/%/,''));
                }
            }
            break;

        case 'bssid':
            // netsh wlan show networks bssid
            res = [];
            var ssids = out.split("\nSSID ");
            if (ssids.length<=1) {
                return res;
            }

            for (var i = 1; i < ssids.length; i++) {
                let bssids = ssids[i].split(' BSSID ');
                let header = bssids[0].trim().split('\n');
                let ssid = header[0].split(':')[1].trim();
                let mode = header[1].split(':')[1].trim().toLowerCase();
                let auth = header[2].split(':')[1].trim().toLowerCase();

                // report each bssid separately
                for (var j = 1; j < bssids.length; j++) {
                    let b = bssids[j].trim().split('\n');

                    var wifinet = {
                        ssid : ssid,
                        mode : mode,
                        auth : auth,
                        bssid : b[0].split(':')[1].trim(),
                        quality : null,
                        version : null,
                        channel : null,
                        rates : []
                    };

                    for (var k = 1; k < b.length; k++) {
                        if (b[k].indexOf('Signal')>=0) {
                            wifinet.quality = parseFloat(b[k].split(':')[1].trim().replace(/%/,''));
                        } else if (b[k].indexOf('Radio type')>=0) {
                            wifinet.version = b[k].split(':')[1].trim();
                        } else if (b[k].indexOf('Channel')>=0) {
                            wifinet.channel = parseInt(b[k].split(':')[1].trim());
                        } else if (b[k].indexOf('rates')>=0) {
                            _.each(b[k].split(':')[1].trim().split(' '), 
                               function(r) {
                                   wifinet.rates.push(parseFloat(r));
                               });
                        }
                    }
                    res.push(wifinet);
                }
            }
            break;

        default:
            throw new Error("syscmdparser 'netsh' dunno how to parse '" + 
                    args.join(' ') + "'");      
        }
    } else if (args[0] === 'interface') {
        var blocks = out.split("Configuration");
        blocks.shift();

        switch (args[args.length-1]) {
        case "dns":
            // netsh interface ip show dns 
            res = {};
            res.nameservers = [];
            while (blocks.length > 0) {
                var lines = blocks[0].split('\n');
                blocks.shift();

                if (lines[0].trim().indexOf('Loopback')>0) {
                    continue;
                }
            
                var line,i;
                for (i = 1; i < lines.length; i++) {            
                    line = lines[i].trim().replace(/\s+/g, ' ').split(': ');
                    if (line[0].toLowerCase().indexOf('dns server')>=0 && 
                        line[1].toLowerCase() !== 'none') 
                    {
                        res.nameservers.push(line[1]);
                    }
                }
            }   
            break;

        case "config":
            // netsh interface ip show config
            res = [];
            while (blocks.length > 0) {         
                var lines = blocks[0].split('\n');
                blocks.shift();
                var name = lines[0].trim().replace(/\s+/g, ' ').split(' "')[1].replace('"','');

                var iface = {
                    name : name.toLowerCase(),
                    type : name.split(' ')[0].toLowerCase(),
                    mask : undefined,
                    gateway : undefined,
                    dhcp : undefined,
                    ipv4 : undefined
                };

                var line,i;
                for (i = 1; i < lines.length; i++) {            
                    line = lines[i].trim().replace(/\s+/g, ' ').split(': ');
                    if (line.length !== 2) { 
                        continue;
                    }

                    switch (line[0].toLowerCase()) {
                    case 'dhcp enabled':
                        iface.dhcp = (line[1] == 'Yes');
                        break;  
                    case 'ip address':
                        iface.ipv4 = line[1];
                        break;  
                    case 'subnet prefix':
                        iface.mask = line[1].split(' ')[2].replace(')','');
                        break;  
                    case 'default gateway':
                        iface.gateway = line[1];
                        break;  
                    }
                }

                if (params && params[0]!==undefined) {
                    // active filtering ?
                    if (params[0] && (iface.ipv4 || iface.ipv6)) {
                        res.push(iface);
                    } else if (!params[0]) {
                        res.push(iface);                    
                    }
                } else {
                    res.push(iface);
                }
            }
            break;

        default:
            throw new Error("syscmdparser 'netsh' dunno how to parse '" + 
                    args.join(' ') + "'");      
        }
    } else {
        throw new Error("syscmdparser 'netsh' dunno how to parse '" + 
                        args.join(' ') + "'");
    }

    return res;
};

parserfuncs["iwconfig"] = function(out, args, params) {
    if (os !== linux) {
        throw new Error("syscmdparser 'iwconfig' not available on '" + os + "'");
    }

    // FIXME: should really return a list of interfaces (can happen that we have more than 1)
    var res = {};
    res.connected = false;
    res.offline = true;

    var line,i;
    var lines = out.split("\n");
    for (i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('no wireless extensions')>=0) {
            continue;
        }

        line = lines[i].trim().replace(/\s+/g, ' ').replace(/=/g,':').split(' ');

        if (line[1] === 'IEEE') {
            res['name'] = line[0];
            res['version'] = line[2];
            res['ssid'] = line[3].split(':')[1];
            if (res['ssid'])
                res['ssid'] = res['ssid'].replace(/"/gi,'');

        } else {
            while (line.length > 0) {
                if (line[0].indexOf('Mode:')>=0) {
                    res['mode'] = (line[0].split(':')[1] === 'Managed' ? 
                           'infrastructure' : 'adhoc');

                } else if (line[0].indexOf('Frequency:')>=0) {
                    res['freq'] = parseFloat(line[0].split(':')[1])
                    if (line[1] === 'GHz') {
                        res['freq'] = res['freq']*1000; // MHz
                    }
                    res['channel'] = consts.freq2channel[parseInt(res['freq'])];
                    line.shift()

                } else if (line[0].indexOf('Point:')>=0) {
                    if (line[1].toLowerCase() !== 'not-associated') {
                        res['bssid'] = line[1];
                        res.connected = true;
                        res.offline = false;
                    }
                    line.shift()

                } else if (line[0].indexOf('Rate:')>=0) {
                    res['txrate'] = parseFloat(line[0].split(':')[1])

                } else if (line[0].indexOf('Tx-Power:')>=0) {
                    res['txpower'] = parseFloat(line[0].split(':')[1])

                } else if (line[0].indexOf('Quality:')>=0) {
                    var tmp = line[0].split(':')[1]
                    if (tmp.indexOf('/')>=0) {
                        // as %
                        tmp = tmp.split('/');
                        res['quality'] = (parseInt(tmp[0])/parseInt(tmp[1]))*100.0
                    } else {
                        res['quality'] = parseFloat(tmp);
                    }

                } else if (line[0].indexOf('Signal')>=0 && 
                    line[1].indexOf('level:')>=0) {
                    res['signal'] = parseFloat(line[1].split(':')[1])
                    line.shift();

                } else if (line[0].indexOf('Noise')>=0 && 
                    line[1].indexOf('level:')>=0) {
                    res['noise'] = parseFloat(line[1].split(':')[1])
                    line.shift();
                }

                line.shift();
            }
        }
    }
    return res;
};

parserfuncs["netcfg"] = function(out, args, params) {
    if (os !== android)
        throw new Error("syscmdparser 'netcfg' not available on '" + os + "'");
    // FIXME
};

parserfuncs["wpa_cli"] = function(out, args, params) {
    if (os !== android || os !== linux)
        throw new Error("syscmdparser 'wpa_cli' not available on '" + os + "'");
    // FIXME
};

parserfuncs["iwlist"] = function(out, args, params) {
    if (os !== linux)
        throw new Error("syscmdparser 'iwlist' not available on '" + os + "'");

    var res = [];
    var blocks = out.split('\n\n');
    _.each(blocks, function(b) {
        if (b.indexOf('Scan completed')>0) {
            var cells = b.split('Cell ');
            for (var i = 1; i < cells.length; i++) {
                var wifinet = {
                    ssid : null,
                    mode : null,
                    auth : null,
                    bssid : null,
                    quality : null,
                    channel : null,
                    rates : []
                };

                // cell info by line
                var lines = cells[i].trim().replace(/=/gi,':').split('\n');
                for (var j = 0; j < lines.length; j++) {
                    if (lines[j].indexOf('Address: ')>=0) {
                        wifinet.bssid = lines[j].trim().split(': ')[1];

                    } else if (lines[j].indexOf('Channel:')>=0) {
                        wifinet.channel = parseInt(lines[j].trim().split(':')[1]);

                    } else if (lines[j].indexOf('Frequency:')>=0) {
                        wifinet.freq = parseFloat(lines[j].trim().split(' ')[0].split(':')[1]);

                    } else if (lines[j].indexOf('ESSID:')>=0) {
                        wifinet.ssid = lines[j].trim().split(':')[1].replace(/"/gi,'');

                    } else if (lines[j].indexOf('Encryption key')>=0) {
                        wifinet.auth = lines[j].trim().split(':')[1];

                    } else if (lines[j].indexOf('Bit Rates:')>=0) {
                        _.each(lines[j].trim().split(':')[1].trim().split(';'), function(r) { 
                            r = r.trim().split(' ')[0];
                            wifinet.rates.push(parseFloat(r.trim()));
                        });
                        if (lines[j+1].indexOf(";")>0) {
                            _.each(lines[j+1].trim().split(';'), function(r) { 
                                r = r.trim().split(' ')[0];
                                wifinet.rates.push(parseFloat(r.trim()));
                            });
                        }

                    } else if (lines[j].indexOf('Mode:')>=0) {
                        wifinet.mode = lines[j].trim().toLowerCase().split(':')[1];

                    } else if (lines[j].indexOf('Quality:')>=0) {
                        var tmp = lines[j].trim().replace(/\s+/g, ' ').split(' ');

                        wifinet.quality = tmp[0].split(':')[1].trim().split('/');
                        if (wifinet.quality.length > 1) {
                            wifinet.quality = 100.0 * (wifinet.quality[0]*1.0 / wifinet.quality[1]);
                        }

                        if (tmp[2].indexOf('level')>=0) {
                            wifinet.signal = parseFloat(tmp[2].split(':')[1].trim());
                        }
                    }
                }
                res.push(wifinet);
            };
        } // else not wireless interface
    });
    return res;
};

parserfuncs["systeminfo"] = function(out, args, params) {
    if (os !== winnt) {
        throw new Error("syscmdparser 'systeminfo' not available on '" + os + "'");
    }

    var lines = out.split("\n");
    var res = {};
    var line,i;
    for (i = 0; i < lines.length; i++) {
        line = lines[i].trim().replace(/\s+/g, ' ').split(': ');
        if (line.length == 2 && line[0].toLowerCase() == 'available physical memory') {
            if (line[1].indexOf('MB')) {
                res.memfree = parseInt(line[1].split(' ')[0].replace(",",""))*1024;
            } else if (line[1].indexOf('GB')) {
                res.memfree = parseInt(line[1].split(' ')[0].replace(",",""))*1024*1024;
            }
            res.unit = 'KB';
        }

        if (line.length == 2 && line[0].toLowerCase() == 'total physical memory') {
            if (line[1].indexOf('MB')) {
                res.memtotal = parseInt(line[1].split(' ')[0].replace(",",""))*1024;
            } else if (line[1].indexOf('GB')) {
                res.memtotal = parseInt(line[1].split(' ')[0].replace(",",""))*1024*1024;
            }
            res.unit = 'KB';
        }

        if (line.length == 3 && line[0].toLowerCase() == 'virtual memory') {
            if (line[2].indexOf('MB')) {
                res['virtual_'+line[1].toLowerCase().replace(/\s+/g, '_')] =  parseInt(line[2].split(' ')[0].replace(",",""))*1024;
            } else if (line[2].indexOf('GB')) {
                res['virtual_'+line[1].toLowerCase().replace(/\s+/g, '_')] = parseInt(line[2].split(' ')[0].replace(",",""))*1024*1024;
            }
            res.unit = 'KB';
        }
        
        // just add all keys and values to the res object
        // FIXME: take care of lists... 
        if (line.length == 2) { 
            res[line[0].toLowerCase().replace(/\s+/g, '_')] = line[1];
        }
    }

    return res;
}

parserfuncs["networksetup"] = function(out, args, params) {
    if (os !== darwin) {
        throw new Error("syscmdparser 'networksetup' not available on '" + os + "'");
    }

    var res = [];
    switch (args[0]) {
        case "-listallhardwareports":
        var ifaces = out.split("\n\n");
        for (var i = 0; i < ifaces.length; i++) {
            var vars = ifaces[i].trim().split('\n');
            var iface = {};
            _.each(vars, function(s) {
                var tmp = s.split(': ');
                switch (tmp[0].trim().toLowerCase()) {
                case "hardware port":
                    iface['type'] = tmp[1].trim().toLowerCase();
                    break;
                case "device":
                    iface['name'] = tmp[1].trim();
                    break;
                case "ethernet address":
                    iface['mac'] = tmp[1].trim();
                    break;
                }
            });
            res.push(iface);
        }
        break;
    default:
        throw new Error("syscmdparser 'networksetup' unknown switch " + args[0]);
    };
    return res;
}

parserfuncs["airport"] = function(out, args) {
    if (os !== darwin) {
        throw new Error("syscmdparser 'airport' not available on '" + os + "'");
    }

    var res = undefined;
    var line,i,key;
    var lines = out.split("\n");

    if (_.contains(args, "-I")) {
        res = {};
        for (i = 0; i < lines.length; i++) {
            line = lines[i].trim().replace(/\s+/g, ' ').split(': ');
            key = line[0].replace(/"/gi,'').replace(/ /gi,'_').toLowerCase();
            switch(key) {
                case 'link auth':
                key = 'auth';   // to match common output
                res[key] = line[1];
                break;

            case 'op mode':
                key = 'mode';   // to match common output
                res[key] = (line[1] === 'station' ? 'infrastructure' : line[1]);
                break;

            case 'agrctlrssi':
                key = 'signal'; // to match common output
                res[key] = parseInt(line[1]);
                break;

            case 'agrctlnoise':
                key = 'noise'; // to match common output
                res[key] = parseInt(line[1]);
                break;

            case 'lasttxrate':
                key = 'txrate';
                res[key] = parseInt(line[1]);
                break;

            case 'maxrate':
            case 'lastassocstatus':
            case 'mcs':
            case 'channel':
            case 'agrextrssi':
            case 'agrextnoise':
                res[key] = parseInt(line[1]);
                break;

            default:
                res[key] = line[1];
                break;
            };
        }
        
        res.connected = (res.state && res.state !== 'init');
        res.offline = (res.airport && res.airport === 'Off');
    
    } else if (_.contains(args, "-s")) {
        // wifi network scan results
        res = [];

        var reg = /(.*) (\w{2}:\w{2}:\w{2}:\w{2}:\w{2}:\w{2}) (-?\d+) (\d+).* [YN]{1} [\-\w]{2} (.*)/;

        for (i = 1; i < lines.length; i++) {
            line = lines[i].trim().replace(/\s+/g, ' ');
            var m = line.match(reg);
            if (m) {
                let o = {
                    ssid : m[1],
                    bssid : m[2],
                    signal : parseInt(m[3]),
                    channel : parseInt(m[4]),
                    auth : m[5]
                };
                res.push(o);
            }
        }
    } else {
        throw new Error("syscmdparser 'airport' unknown params: " + 
                args.join(' '));
    }

    return res;
};

parserfuncs["ip"] = function(out, args, params) {
    var res = [];
    var lines = out.split("\n");
    
    // ip [ OPTIONS ] OBJECT 
    var idx = 0;
    var obj = args[idx];
    while (obj.indexOf('-')>=0) {
        idx += 1;
        if (obj === '-f') {
            // has a param
            idx += 1;
        }
        obj = args[idx];
    }

    switch (obj) {
    case "neigh":
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            if (line.length!==6) {
                continue;
            }

            res.push({
                hostname : null,
                address : line[0],
                iface : line[2],
                mac : line[4]
            });
        }
        break;

    case "addr":
        if (!_.contains(args, "-o")) { 
            throw new Error("syscmdparser 'ip -o addr show' required");
        }

        for (var i = 0; i < lines.length; i++) {
            var str = lines[i].trim().replace(/\s+/g, ' ');
            if (!str) {
                continue;
            }

            var re = /^\d+: ([\w\d]+) /gi;
            var name = re.exec(str);
            if (name) {
                name = name[1];
            }
            var iface = _.find(res, function(iface) { 
                return (iface.name === name); 
            }) || { name : name };
     
            var attrs = {
                'ipv4': /inet ([\.\d]+)\/(\d+) /gi,
                'ipv6': /inet6 ([\:\d\w]+\/\d+) /gi,
                'broadcast': /brd ([\.\d]+) /gi,
            };

            _.each(attrs, function(value, key) {
                var m = null;
                while ((m = value.exec(str)) !== null) {
                    iface[key] = m[1];
                    if (key === 'ipv4' && m[2]) {
                        var mask = parseInt(m[2]);
                        iface['mask'] = "";
                        var s = '';
                        for (var i = 0; i <= 32; i++) {
                            if (s.length === 8) {
                                iface['mask'] += parseInt(s, 2) + '.';
                                s = '';
                            }
                            s += (i >= mask ? '0' : '1');
                        }
                        iface['mask'] = iface['mask'].slice(0,-1);
                    }
                }
            });
            res.push(iface);        
        }
        break;

    case "link":
        for (var i = 0; i < lines.length; i++) {
            var str = lines[i].trim().replace(/\s+/g, ' ');
            if (!str) {
                continue;
            }

            var iface = {};
            var attrs = {
                'name': /^\d+: ([\w\d]+): /gi,
                'type': /link\/(\w+) /gi,
                'mac': /link\/\w+ ([\w:\d]+) /gi,
                'mtu': /mtu (\d+) /gi,
                'qdisc': /qdisc ([\w_]+) /gi,
                'txqueuelen': /qlen (\d+)\\ /gi
            };

            _.each(attrs, function(value, key) {
                var m = null;
                while ((m = value.exec(str)) !== null) {
                    iface[key] = m[1];
                    if (key === 'mtu' || key === 'txqueuelen') {
                        iface[key] = parseInt(m[1]);
                    } else if (key === 'type') {
                        iface[key] = m[1].toLowerCase();
                    }
                }
            });
            
            res.push(iface);
        }
        break;

    default:
        // don't know what to do
        throw new Error("syscmdparser 'ip' unknown object: " + obj);
    }

    return res;
};

parserfuncs["route"] = function(out, args, params) {
    var res = undefined;
    if (_.contains(args, 'default')) {
        res = {};
        var lines = out.split("\n");
        for (var i = 1; i < lines.length; i++) {
            if (lines[i].indexOf(': ') < 0) {
                continue;
            }
            
            var line = lines[i].trim().toLowerCase().replace(/\s+/g, ' ').split(': ');
            if (line.length >= 2) {
                res[line[0].trim()] = line[1].trim();
            }
        }
    } else {
        res = [];
        switch (os) {
        case winnt:
            var blocks = out.split("Active Routes:");

            if (blocks.length > 1) {
                var lines = blocks[1].trim().split("\n");
                for (var i = 1; i < lines.length; i++) {
                    if (lines[i].indexOf('=') === 0) {
                        break;
                    }
                    
                    var line = lines[i].trim().toLowerCase().replace(/\s+/g, ' ').split(' ');
                    if (line.length == 5) {
                        var o = {
                            destination : line[0],
                            mask : line[1],
                            gateway : line[2],
                            iface : line[3],
                            metric : parseInt(line[4])
                        }
                        o.defaultroute = (o.destination === '0.0.0.0' || o.destination === 'default');
                        res.push(o);
                    }
                }
            }

            if (blocks.length > 2) {
                var lines = blocks[2].trim().split("\n");
                for (var i = 1; i < lines.length; i++) {
                    if (lines[i].indexOf('=') === 0) {
                        break;
                    }
                    
                    var line = lines[i].trim().toLowerCase().replace(/\s+/g, ' ').split(' ');
                    if (line.length == 4) {
                        var o = {
                            ifindex : line[0],
                            metric : parseInt(line[1]),
                            destination : line[2].split('/')[0],
                            mask : line[2].split('/')[1],
                            gateway : line[3]
                        }
                        o.defaultroute = (o.destination === '0.0.0.0' || o.destination === 'default');
                        res.push(o);
                    }
                }
            }
            break;

        default:    
            var lines = out.split("\n");        
            var h = undefined;
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim().toLowerCase().replace(/\s+/g, ' ').split(' ');            
                if (line[0] === 'destination') {
                    h = line.splice(0);         

                } else if (h && h.length >= line.length) {
                    var o = {};
                    _.each(h, function(key,idx) {
                        key = (key === 'netif' ? 'iface' : key);
                        if (idx < line.length) {
                            o[key] = line[idx];
                        }
                    });
                    o.defaultroute = (o.destination === '0.0.0.0' || o.destination === 'default');
                    res.push(o);

                } else {
                    h = undefined;
                }
            }
        }
    }   
    return res;
};

parserfuncs["netstat"] = function(out, args, params) {
    var res = [];
    var lines = out.split("\n");
    var i, line;

    if (_.intersection(args, ['-b','-i']).length === 2 && os === darwin) {
        // interface statistics
        for (i = 1; i < lines.length; i++) {
            line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            if (line.length !== 11) {
                continue;
            }

            res.push({
                name : line[0].replace(/:/,''),
                rx : {
                    packets : parseInt(line[4]), 
                    bytes : parseInt(line[6])
                },
                tx : {
                    packets : parseInt(line[7]), 
                    bytes : parseInt(line[9])
                }
            });
        }
        // remove duplicates
        res = _.uniq(res, function(item, key, a) { 
            return item.name;
        }); 
    } else if (_.intersection(args, ['-e']).length === 1 && os === winnt) {
        // interface statistics
        var obj = {
            name : 'ethernet',
            rx : {
                packets : 0, 
                bytes : 0
            },
            tx : {
                packets : 0, 
                bytes : 0
            }
        }

        for (i = 1; i < lines.length; i++) {
            line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            if (line.length < 3) {
                continue;
            }
            
            if (line[0] === 'Bytes') {
                obj.rx.bytes = parseInt(line[1]);
                obj.tx.bytes = parseInt(line[2]);
            } else if (line[0] === 'Unicast') {
                obj.rx.packets = parseInt(line[2]);
                obj.tx.packets = parseInt(line[3]);
            }
        }

        res.push(obj);
    
    } else if (_.intersection(args, ['-r']).length === 1) {
        // routing table
        res = [];
        var h = undefined;
        for (i = 0; i < lines.length; i++) {
            line = lines[i].trim().toLowerCase().replace(/\s+/g, ' ').split(' ');
            if (line.length < 4) {
                continue;
            }

            if (line[0] === 'destination') {
                h = line.splice(0);         

            } else if (h && h.length >= line.length) {
                var o = {};
                _.each(h, function(key,idx) {
                    key = (key === 'netif' ? 'iface' : key);
                    if (idx < line.length) {
                        o[key] = line[idx];
                    }
                });

                if (o.destination.indexOf('/') > 0) {
                    let tmp = o.destination.split('/');
                    o.destination = tmp[0];
                    o.mask = parseInt(tmp[1]);
                }
                o.defaultroute = (o.destination === '0.0.0.0' || o.destination === 'default');                
                res.push(o);

            } else {
                h = undefined;
            }
        }
    } else {
        // ok don't know what to do
        throw new Error("syscmdparser 'netstat' unknown options: " + args.join(' '));
    }
    return res;
};

parserfuncs["top"] = function(out, args, params) {
    var res = { 
    tasks : {
        total: null,
        running: null,
        sleeping: null,
    },
    loadavg : {
        onemin : null,
        fivemin : null,
        fifteenmin : null,
    },
    cpu : {
        user: null,
        system: null,
        idle : null,
        total : null
    },
    memory : {
        total : null,
        used: null,
        free: null,
    },
    };

    var lines = out.split("\n");

    switch (os) {
    case android:
        for (var i = 0; i < lines.length; i++) {
            var row = lines[i].trim().replace(/\s+/g, ' ').split(' ');

            if (row[2] === 'System') {
                // User 0%, System 0%, IOW 0%, IRQ 0%
                res.cpu.user = parseFloat(row[1].replace('%,',''));
                res.cpu.system = parseFloat(row[3].replace('%,',''));
                res.cpu.total = (res.cpu.user + res.cpu.system);
                res.cpu.idle = 100.0 - res.cpu.total;

            } else if (row[3] === 'Nice') {
                // User 8 + Nice 1 + Sys 23 + Idle 270 + IOW 1 + IRQ 0 + SIRQ 0 = 303
                res.tasks.total = parseInt(row[21]);
                res.tasks.sleeping = parseInt(row[10]);
                res.tasks.running = res.tasks.total - res.tasks.sleeping;
            }
        }
        break;

    case linux:
        for (var i = 0; i < lines.length; i++) {
            var row = lines[i].trim().replace(/\s+/g, ' ').split(' ');

            switch(row[0]) {
            case "top":
                for (var j = 1; j<row.length; j++) {
                    if (row[j] == "average:") {
                        res.loadavg.onemin = parseFloat(row[j+1].replace(',',''));
                        res.loadavg.fivemin = parseFloat(row[j+2].replace(',',''));
                        res.loadavg.fifteenmin = parseFloat(row[j+3].replace(',',''));
                        break;
                    }
                }
                break;

            case "Tasks:":
                res.tasks.total = parseInt(row[1]);
                res.tasks.running = parseInt(row[3]);
                res.tasks.sleeping = parseInt(row[5]);
                break;

            case "%Cpu(s):":
                res.cpu.user = parseFloat(row[1]);
                res.cpu.system = parseFloat(row[3]);
                res.cpu.idle = parseFloat(row[7]);
                res.cpu.total = 100.0 - res.cpu.idle;
                break;

            case "KiB":
                if (row[1] == 'Mem:') {
                    res.memory.total = parseInt(row[2])*1024;
                    res.memory.used = parseInt(row[4])*1024;
                    res.memory.free = parseInt(row[6])*1024;
                    res.memory.unit = "B";
                }
                break;
            default:
            };
        }
        break;

    case darwin:
        for (var i = 0; i < lines.length; i++) {
            var row = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            switch(row[0]) {
            case "Processes:":
                res.tasks.total = parseInt(row[1]);
                res.tasks.running = parseInt(row[3]);
                res.tasks.sleeping = parseInt(row[7]);
                break;
            case "Load":
                res.loadavg.onemin = parseFloat(row[2].replace(',',''));
                res.loadavg.fivemin = parseFloat(row[3].replace(',',''));
                res.loadavg.fifteenmin = parseFloat(row[4].replace(',',''));
                break;
            case "CPU":
                res.cpu.user = parseFloat(row[2].replace('%',''));
                res.cpu.system = parseFloat(row[4].replace('%',''));
                res.cpu.idle = parseFloat(row[6].replace('%',''));
                res.cpu.total = 100.0 - res.cpu.idle;
                break;
            case "PhysMem:":
                res.memory.used = parseInt(row[1].replace('M',''))*1024*1024;
                res.memory.free = parseInt(row[5].replace('M',''))*1024*1024;
                res.memory.total = (res.memory.used + res.memory.free);
                res.memory.unit = "B";
                break;
            default:
            };
        }
        break;

    default:
        throw new Error("syscmdparser 'top' not available on '" + os + "'");    
    }

    return res;
};

// -- tools --

parserfuncs["arp"] = function(out, args) {
    var lines = out.split("\n");
    var res = [], i, line;
    
    switch (os) {
    case linux:
    case android:
        for (i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('timed out')>=0) {
                break;
            }

            line = lines[i].trim().replace(/\s+/g,' ').split(' ');
            if (line.length > 6) {
                res.push({
                    hostname : (line[0] !== '?' ? line[0] : null),
                    address : line[1].replace(/\(|\)/gi,''),
                    mac : line[3],
                    type : line[4].replace(/\[|\]/gi,''),
                    iface : line[6]
                });
            }
        }
        break;

    case darwin:
        for (i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('timed out')>=0) {
                break;
            }

            line = lines[i].trim().replace(/\s+/g,' ').split(' ');

            if (line.length > 5) {
                res.push({
                    hostname : (line[0] !== '?' ? line[0] : null),
                    address : line[1].replace(/\(|\)/gi,''),
                    mac : line[3],
                    iface : line[5],
                    type : line[line.length-1].replace(/\[|\]/gi,'')
                });
            }
        }
        break;

    case winnt:
        for (i = 0; i < lines.length; i++) {
            line = lines[i].trim().replace(/\s+/g,' ').split(' ');

            if (line.length==3) {
                res.push({
                    hostname : undefined,
                    address : line[0],
                    mac : line[1].replace(/-/gi,':'),
                    iface : undefined,
                    type : line[2]
                });
            }
        }
        break;

    default:
        throw new Error("syscmdparser 'arp' not available on '" + os + "'");    
    }

    return res;
}

parserfuncs["nslookup"] = function(out, args, params) {    
    var res = {
        query: args[args.length-1],
        server : undefined,
        answers : []
    };

    var curr = {
        name : undefined,
        address : undefined
    };

    var i, line;
    var lines = out.split("\n");
    for (i = 0; i < lines.length; i++) {
        line = lines[i].trim().toLowerCase().replace(/\s+/g,' ').split(' ');
        
        if (line[0] === 'server:') {
            res.server = line[1];
        } else if (os == winnt && line[0] === 'address:' && 
                   res.server && !curr.name) {
            res.server = line[1];
        } else if (line[0] === 'name:') {
            if (curr.name) {
                res.answers.push(curr);
                curr = {
                    name : undefined,
                    address : undefined
                };  
            }
            curr.name = line[1];
        } else if ((line[0] === 'address:' || 
                line[0] === 'addresses:') && curr.name) {
            curr.address = line[1];
        }
    }

    if (curr.name) {
        res.answers.push(curr);
    }
    return res;
}

parserfuncs["ping"] = function(out, args, params) {
    var lines = out.split("\n");

    var res = {
        dst: args[args.length-1],
        dst_ip : undefined,             // resolved IP
        count : 0,                      // -c
        lost : 0,                       // lost pkts
        bytes : 0,                      // -b or default
        ttl : undefined, 
        rtt : [],                       // results
        rttIndex : {},                  // rtts by icmp_seq
        stats : undefined,              // rtt stats
        time_exceeded_from : undefined, // IP of sender
        alt : []                        // full responses
    };

    var i,line,idx;

    switch (os) {
    case linux:
    case android:
        idx = 0;
        while (idx < args.length) {
            switch (args[idx]) {
            case "-c": 
                res.count = parseInt(args[idx+1]);
                idx += 2;
                break;
            case "-t": 
                res.ttl = parseInt(args[idx+1]);
                idx += 2;
                break;
            default:
                idx += 1;
            }
        }

        for (i = 0; i < lines.length; i++) {        
            line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            if (lines[i].toLowerCase().indexOf('time to live exceeded')>=0) {
                res.time_exceeded_from = line[1];
                break;  
                        
            } else if (line[0] === 'PING') {
                res.dst_ip = line[2].replace(/\(|\)|:/gi, '');
                res.bytes = parseInt((line[3].indexOf('\(') < 0 ? line[3] : line[3].substring(0,line[3].indexOf('\('))));

            } else if (line[1] === 'bytes') {
                for (var j = 2; j < line.length; j++) {
                    if (line[j].indexOf("icmp_seq=") === 0) {
                        var last_seq_num = parseInt(line[j].split('=')[1]);
                    } else if (line[j].indexOf('time=') === 0) {
                        var tmp = line[j].split('=');
                        let rtt = parseFloat(tmp[1]);
                        res.rtt.push(rtt);
                        res.rttIndex[last_seq_num-1] = rtt;
                    }
                }
            }
        }
        break;

    case darwin:
        idx = 0;
        while (idx < args.length) {
            switch (args[idx]) {
            case "-c": 
                res.count = parseInt(args[idx+1]);
                idx += 2;
                break;
            case "-m": 
                res.ttl = parseInt(args[idx+1]);
                idx += 2;
                break;
            default:
                idx += 1;
            }
        }

        for (i = 0; i < lines.length; i++) {        
            line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            if (lines[i].toLowerCase().indexOf('time to live exceeded')>=0) {
                res.time_exceeded_from = line[3].replace(/:/gi, '');
                break;          

            } else if (line[0] === 'PING') {
                res.dst_ip = line[2].replace(/\(|\)|:/gi, '');
                res.bytes = parseInt(line[3]);

            } else if (line[1] === 'bytes') {
                var ip = line[3].replace(/:/,'');
                var a = _.find(res.alt, function(a) {
                    return (a.address === ip)
                });

                if (!a) {
                    a = { address : ip, rtt : [] };
                    res.alt.push(a);
                }
                    
                for (var j = 2; j < line.length; j++) {
                    if (line[j].indexOf("icmp_seq=") === 0) {
                        var last_seq_num = parseInt(line[j].split('=')[1]);
                    } else if (line[j].indexOf('time=') === 0) {
                        var tmp = line[j].split('=');
                        var rtt = parseFloat(tmp[1]);
                        res.rtt.push(rtt);
                        res.rttIndex[last_seq_num] = rtt;
                        a.rtt.push(rtt);
                    }
                }
            }
        }
        break;

    case winnt:
        idx = 0;
        while (idx < args.length) {
            switch (args[idx]) {
                case "-n": 
                res.count = parseInt(args[idx+1]);
                idx += 2;
                break;
            case "-i": 
                res.ttl = parseInt(args[idx+1]);
                idx += 2;
                break;
            default:
                idx += 1;
            }
        }
        
        for (i = 0; i < lines.length; i++) {        
            line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
            if (lines[i].toLowerCase().indexOf('ttl expired')>=0) {
                res.time_exceeded_from = line[2].replace(/:/gi, '');
                break;          

            } else if (line[0] === 'Pinging') {
                if (line[3]==='with') {
                    res.dst_ip = line[2].replace(/\(|\)|:|\[|\]/gi, '');
                    res.bytes = parseInt(line[4]);
                } else if (line[2]==='with') {
                    res.dst_ip = line[1].replace(/\(|\)|:|\[|\]/gi, '');
                    res.bytes = parseInt(line[3]);
                }   

            } else if (line[0] === 'Reply') {
                for (var j = 2; j < line.length; j++) {             
                    if (line[j].indexOf('time=') === 0) {
                        var tmp = line[j].split('=');
                        res.rtt.push(parseFloat(tmp[1].replace('ms','')));
                    } else if (line[j].indexOf('time<1') === 0) {
                        res.rtt.push(0.1);
                    }
                }
            }
        }
        break;
    }

    // count stats
    if (res.count > 0) {
        res.lost = res.count - res.rtt.length;
    }

    if (res.lost < 0) {
        // bcast probably
        res.lost = (res.alt.length > 0 ? 0 : res.count);
    }

    res.stats = describe(res.rtt);

    return res;
};

parserfuncs["fping"] = function(out, args) {
    if (!_.contains(args, "-C")) { 
        throw new Error("syscmdparser fping -C required");
    };

    var res = {
        dst: args[args.length-1],
        count : 0,               // -C
        lost : 0,                // lost pkts
        bytes : 56,              // -b or default
        ttl : undefined,         // -H or default
        rtt : [],                // results
        stats : undefined,        // basic stats
        time_exceeded_from : undefined
    };

    var idx = 0;
    while (idx < args.length) {
        switch (args[idx]) {
        case "-C": 
            res.count = parseInt(args[idx+1]);
            idx += 2;
            break;
        case "-H": 
            res.ttl = parseInt(args[idx+1]);
            idx += 2;
            break;
        case "-b": 
            res.bytes = parseInt(args[idx+1]);
            idx += 2;
            break;
        default:
            idx += 1;
        }
    }

    var lines = out.split("\n");
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
        if (lines[i].toLowerCase().indexOf('time exceeded')>=0) {
            res.time_exceeded_from = line[4];
            break;

        } else if (/\d+\.?\d*/.test(line[5])) {
            res.rtt.push(parseFloat(line[5]));
        }
    }

    // count stats
    if (res.count > 0) {
        res.lost = res.count - res.rtt.length;
    }
    res.stats = describe(res.rtt);

    return res;
};

parserfuncs["traceroute"] = function(out, args) {
    var lines = out.split("\n");

    var res = {
        dst: args[args.length-1],
        nqueries : 3,
        hops: [],        // { hostname : val, rtt : [], address : val, id : val };
    };

    switch (os) {
    case linux:
    case android:
    case darwin:
        var idx = 0;
        while (idx < args.length) {
            switch (args[idx]) {
                case "-q": 
                res.nqueries = parseInt(args[idx+1]);
                idx += 2;
                break;
            default:
                idx += 1;
            }
        }

        var currhop = {};        
        for (var i = 0; i < lines.length; i++) {
            var str = lines[i].trim();

            if (!str || str.length === 0 || str.indexOf('traceroute')>=0) {
                continue;
            }

            var ent = str.replace(/\s+/g,' ').replace(/\sms/g,'').split(' ');

            if (/^\d{1,2} /.test(str)) {
                if (currhop.id) {
                    res.hops.push(currhop);
                }
                currhop = {};
                currhop.id = parseInt(ent[0].trim());
                ent = ent.slice(1);
            }
            
            if (ent[0] == '*') {
                currhop.address = undefined;
                currhop.hostname = '*';
                currhop.rtt = [];
                currhop.missed = res.nqueries;
                currhop.alt = [];
            } else {
                var ip = ent[1].replace(/\(|\)/gi, '');
                currhop.address = ip;
                currhop.hostname = ent[0];
                currhop.rtt = [];
                currhop.missed = 0;
                currhop.alt = [];

                var idx = 2;
                while (idx < ent.length) {
                    if (ent[idx] === '*') {
                        currhop.missed += 1;
                        idx += 1;
                    } else if (/\(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\)/.test(ent[idx+1])) {
                        ip = ent[idx+1].replace(/\(|\)/gi, '');
                        currhop.alt.push({hostname : ent[idx], address : ip});
                        idx += 2;
                    } else {
                        currhop.rtt.push(parseFloat(ent[idx]));
                        currhop.alt.push({hostname : currhop.hostname, address : currhop.address});
                        idx += 1;
                    }
                }
            }
        } // for lines
        if (currhop.id>0) {
            res.hops.push(currhop);
        }
        break;

    default:
        throw new Error("syscmdparser 'traceroute' not available on '" + os + "'"); 
    }

    return res;
};

parserfuncs["tracert"] = function(out, args, params) {
    var lines = out.split("\n");

    var res = {
        dst: args[args.length-1],
        hops: [],        // { hostname : val, rtt : [], address : val, id : val };
    };
    
    switch (os) {
    case winnt: 
        var currhop = {};
        for (var i = 0; i < lines.length; i++) {
            var str = lines[i].trim();
            if (!str || str.length === 0) {
                continue;
            }

            var ent = str.replace(/\s+/g,' ').replace(/\sms/g,'').split(' ');
            if (/^\d{1,2} /.test(str)) {
                if (currhop.id) {
                    res.hops.push(currhop);
                }
                currhop = {};
                currhop.id = parseInt(ent[0].trim());
                ent = ent.slice(1);
            
                if (ent[0] == '*') {
                    currhop.address = undefined;
                    currhop.hostname = '*';
                    currhop.rtt = [];
                    currhop.missed = res.nqueries;
                    currhop.alt = [];

                } else {
                    var ip = ent[3].replace(/\(|\)/gi, '');
                    currhop.address = ip;
                    currhop.rtt = [];
                    currhop.missed = 0;
                    currhop.alt = [];
                    var idx = 0;
                    while (idx < ent.length-1) {
                        if (ent[idx] === '*') {
                            currhop.missed += 1;
                            idx += 1;
                        } else {
                            currhop.rtt.push((ent[idx] === '<1' ? 0.1 : parseFloat(ent[idx])));
                            currhop.alt.push({hostname : currhop.hostname, address : currhop.address});
                            idx += 1;
                        }
                    }
                }
            }
        }   
        if (currhop.id>0) {
            res.hops.push(currhop);
        }
        break;
    default:    
        throw new Error("syscmdparser 'tracert' not available on '" + os + "'");    
    }

    return res;
};

parserfuncs["mtr"] = function(out, args, params) {
    if (!_.contains(args, "--raw")) { 
        throw new Error("syscmdparser mtr --raw required");
    };

    var res = {
        dst: args[args.length-1],
        nqueries : 0,
        hops: [] 
    };

    var idx = 0;
    while (idx < args.length) {
        switch (args[idx]) {
        case "-c": 
            res.nqueries = parseInt(args[idx+1]);
            idx += 2;
            break;
        default:
            idx += 1;
            break;
        }
    }

    var lines = out.split("\n");
    for (var i = 0; i < lines.length; i++) {
        var tmp = lines[i].trim().split(' ');
        var hopid = parseInt(tmp[1]);
        switch (tmp[0]) {
        case 'h':
            res.hops[hopid] = { 
                address : tmp[2],
                hostname : undefined, 
                missed : res.nqueries, 
                rtt : [] 
            };
            break;
            
        case 'p':
            var hop = res.hops[hopid];
            hop.missed -= 1;
            hop.rtt.push(parseInt(tmp[2])/1000.0);
            break;
            
        case 'd':
            var hop = res.hops[hopid];
            hop.hostname = tmp[2];
            break;
        }
    }
    // did we reach the destination ?
    res.succ = (res.hops.length > 0 && 
        (res.hops[res.hops.length-1].address === res.dst ||
         res.hops[res.hops.length-1].hostname === res.dst));

    // trim off the last dupl hop (if succ)
    if (res.hops.length > 1 && 
        (res.hops[res.hops.length-1].address === 
         res.hops[res.hops.length-1].address)) {
        res.hops = res.hops.slice(0,res.hops.length-1);
    }

    return res;
};

parserfuncs["iperf"] = function(out, args) {
    var idx = _.indexOf(args, '-y');
    if (idx < 0 || (args[idx+1].toLowerCase() !== 'j' &&
            args[idx+1].toLowerCase() !== 'c')) {
        throw new Error("syscmdparser iperf -Y [j|c] required");
    }

    // reporting style
    var iscsv = (args[idx+1].toLowerCase() === 'c');

    var res = {
        header : {                 // configuration
            test : {
            proto : "tcp",         // -u
            duration : 10,         // -t
            bytes : undefined,     // -n
            rate : undefined,      // -b
            mode : "normal"        // normal, tradeoff, reverse, dual
            },
            role : undefined,          // client or server
            local_host : undefined,
            remote_host : undefined
        },
        local : {                      // local received and/or sent data
            recv : undefined,
            send : undefined
        },
        remote : {                     // remote received and/or sent data
            recv : undefined,
            send : undefined
        }
    };

    // fill some of the header with the cmd params
    var idx = 0;
    while (idx < args.length) {
        switch (args[idx]) {
        case "-c": 
            res.header.role = "client";
            idx += 1;
            break;
        case "-s": 
            res.header.role = "server";
            idx += 1;
            break;
        case "-t": 
            res.header.test.duration = parseInt(args[idx+1]);
            idx += 2;
            break;
        case "-b": 
            res.header.test.rate = args[idx+1];
            idx += 2;
            break;
        case "-n": 
            res.header.test.bytes = args[idx+1];
            idx += 2;
            break;
        case "-u": 
            res.header.test.proto = "udp";
            idx += 1;
            break;
        case "-d": 
            res.header.test.mode = "dual";
            idx += 1;
            break;
        case "-r": 
            res.header.test.mode = "tradeoff";
            idx += 1;
            break;
        case "-E": 
            res.header.test.mode = "reverse";
            idx += 1;
            break;
        default:
            idx += 1;
            break;
        }
    }

    var gettimestamp = function(s) {
        if (s.length<14) {
            return { timein : s, timesec : parseInt(s) };
        } else {
            var d = new Date(parseInt(s.substring(0,4)), // year
                     parseInt(s.substring(4,6)), // month
                     parseInt(s.substring(6,8)), // date
                     parseInt(s.substring(8,10)), // hour
                     parseInt(s.substring(10,12)), // minute
                     parseInt(s.substring(12,14)), // second
                     0); // ms
        }
        return {time : d.toJSON(),
            timemsec : d.getTime(),
            timein : s};
    };

    var lines = out.split('\n');

    if (iscsv) {
        var tmp = lines[0].split(',');
        res.header.local_host = tmp[1];
        res.header.remote_host = tmp[3];

        var obj = {
            local_port : parseInt(tmp[2]),
            remote_port : parseInt(tmp[4]),
            intervals : [],
            total : undefined
        }

        for (var i = 0; i<lines.length; i++) {          
            tmp = lines[i].split(',');
            var iobj = {
                timestamp : gettimestamp(tmp[0]),
                startTime : parseFloat(tmp[6].split('-')[0]),
                endTime : parseFloat(tmp[6].split('-')[1]),
                bytes : parseFloat(tmp[7]),
                rate : parseFloat(tmp[8]),
            }

            if (tmp.length > 10) {
                _.extend(iobj, {
                        jitter : parseFloat(tmp[9]),
                        errorCnt : parseInt(tmp[10]),
                        dgramCnt : parseInt(tmp[11]),
                        errorRate : parseFloat(tmp[12]),
                        outOfOrder : parseFloat(tmp[13])
                });
            }
            // KB
            iobj.bytesK = iobj.bytes / 1024.0;
            // MB
            iobj.bytesM = iobj.bytes / 1024.0 / 1024.0;
            // bytes / s
            iobj.rate = iobj.bytes / (iobj.endTime - iobj.startTime);
            // bits / s
            iobj.ratebit = iobj.rate * 8.0;
            // Kbit / s
            iobj.rateKbit = iobj.ratebit *  (1.0 / 1000 );
            // Mbit / s
            iobj.rateMbit = iobj.ratebit *  (1.0 / 1000 / 1000);
            
            var local_port = parseInt(tmp[2]);
            var remote_port = parseInt(tmp[4]);
            
            if (local_port !== obj.local_port || 
                remote_port !== obj.remote_port) {

                obj.total = obj.intervals.pop();
                if (res.header.role === "client") {
                    if (!res.local.send && 
                        res.header.test.mode !== "reverse") {
                        // client send report (except -E)
                        res.local.send = obj;
                    } else if (local_port === obj.remote_port &&
                           remote_port === obj.local_port) 
                    {
                       // server side recv report
                        res.remote.recv = obj;
                    } else {
                        // client recv report (-E, -d or -r)
                        res.local.recv = obj;
                    }
                } else {
                    if (!res.local.recv && 
                        res.hearder.test.mode !== "reverse") {
                        // server recv report (except -E)
                        res.local.recv = obj;
                    } else if (!res.local.send) {
                        // server send report (-E, -d or -r)
                        res.local.send = obj;
                    } else {
                        // remote side recv report (-u and -E, -d or -r)
                        res.remote.recv = obj;
                    }
                }

                // reset
                obj = {
                    local_port : local_port,
                    remote_port : remote_port,
                    intervals : [],
                    total : undefined
                }
            }
            obj.intervals.push(iobj);
        }

        // handle last
        obj.total = obj.intervals.pop();
        if (res.header.role === "client") {
            if (!res.local.send && res.header.test.mode !== "reverse") {
                // client send report (except -E)
                res.local.send = obj;
            } else if (res.header.test.mode === "normal") {
                // server side recv report
                res.remote.recv = obj;
            } else {
                // client recv report (-E, -d or -r)
                res.local.recv = obj;
            }
        } else {
            if (!res.local.recv && res.header.test.mode !== "reverse") {
                // server recv report (except -E)
                res.local.recv = obj;
            } else if (!res.local.send) {
                // server send report (-E, -d or -r)
                res.local.send = obj;
            } else {
                // remote side recv report (-u and -E, -d or -r)
                res.remote.recv = obj;
            }
        }
    } else { // json
        // just to match the common output format
    }
    return res;
};

//--------------------------------
// public API

/** @return True if we know how to parse the cmd, else false. */
var isCmdSupported = exports.isCmdSupported = function(cmd) {
    return (parserfuncs[cmd] && _.isFunction(parserfuncs[cmd]));
};

/** Parse output (and errors) from the given system command run on
 *  the given os.
 */
var parse = exports.parse = function(err, stdout, stderr, cmd, args, params) {
    if (!cmd) {
        throw new Error("syscmdparser missing command");
    }

    if (!isCmdSupported(cmd)) {
        throw new Error("syscmdparser does not support '" + 
                cmd + "' command");
    }
    
    var res = {
        ts : Date.now(),
        cmd : cmd,
        cmdline : cmd + ' ' + args.join(' '),
        params : params,
        os : os,
        result : undefined
    };
    
    if (err) {
        let code = err.code || err;

        // deal with some exceptions, we have usefull output even
        // if the process exits with an error code
        if (cmd === 'ping' && 
            ((code == 2 && os === darwin) || 
             (code == 1 && (os === linux || os === android || os === winnt)) || 
             (code == 256 && (os === linux || os === android)) || 
             (code == 512 && os === darwin))) 
        {
            res.error = undefined;
        } else if (cmd === 'fping' && code == 1) {
            res.error = undefined;
            stdout = stderr;
        } else {
            console.log("syscmdparser error",code,stdout,stderr);
            res.error = error("execerror",code).error;
            res.stderr = (stderr ? stderr.trim() : "");
            res.stdout = (stdout ? stdout.trim() : "");
        }
    }
    
    if (!res.error) {
        stdout = (stdout ? stdout.trim() : "");
        res.result = parserfuncs[cmd](stdout, args, params);
    }

    return res;
};

