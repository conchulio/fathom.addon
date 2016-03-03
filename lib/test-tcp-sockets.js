var timers = require('sdk/timers');
var socketapi = require("../lib/socketapi");

var manifest = {
    api : {"socket" : "*"},
    allowdst : {
    "*" : {"127.0.0.1" : { 9797 : true },
           "{server}" : { '*' : true }},
    },
    neighbors : {},
    isaddonpage : false,
    winid : 'test'
};

exports["testtcpclose"] = function() {
    var NUMBER_OF_CONNECTIONS = 1000;
    var stopServer = false;
    var reqid = 0;
    var openedSockets = 0;
    var closedSockets = 0;
    var getreq = function(method, params, cont) {
        reqid += 1; 
        cont = (cont !== undefined ? cont : false);
        return { module : 'socket', 
             submodule : 'tcp', 
             id : reqid,
             multiresp : cont, // multiresponse request
             method : method, 
             params : params};
    };

    var cli = function() {
        socketapi.exec(function(s) {
            if(s.error !== undefined) {
                console.error("client socket.tcp.openSocket error", s.error);
            }
            openedSockets += 1
            console.log('Opened socket! openedSockets: ', openedSockets)

            // socketapi.exec(function(res) {
            //     if(res.error === undefined)
            //           console.log("client socket.tcp.tcpConnect no error");

                socketapi.exec(function(res) {
                    if(res.error === undefined)
                          console.log("client socket.tcp.send no error");

                    socketapi.exec(function(res) {
                    if(res.error === undefined)
                          console.log("client socket.tcp.recv no error");
                    
                    if(res /*&& res.data === "foo"*/)
                          console.log("client socket.tcp.recv got pong");

                    var stuff = getreq('close',[s]);
                    
                    socketapi.exec(function() {
                        closedSockets+=1;
                        console.log('openedSockets',openedSockets) 
                        console.log('closedSockets',closedSockets)
                        console.log('openedSockets-closedSockets', openedSockets-closedSockets)
                        if (reqid < NUMBER_OF_CONNECTIONS) {
                            timers.setTimeout(cli,1000/*ms*/);
                            console.log("Scheduling reqid "+reqid)
                        } else {
                            stopServer = true;
                            console.log("Set stop server")
                        }
                    }, stuff);

                    },getreq('recv',[s,true,2000]),manifest);
                },getreq('send',[s,"foo"]),manifest);       
            // }, getreq('tcpConnect',[s, "127.0.0.1", 9797]),manifest);
        }, getreq('tcpOpenSendSocket',["127.0.0.1", 9797, true]),manifest);  
    };

    timers.setTimeout(cli,0);
};
