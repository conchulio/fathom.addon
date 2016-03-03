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

exports["testudpclose"] = function() {
    var NUMBER_OF_CONNECTIONS = 1000;
    var stopServer = false;
    var reqid = 0;
    var openedSockets = 0;
    var closedSockets = 0;
    var getreq = function(method, params, cont) {
        reqid += 1; 
        cont = (cont !== undefined ? cont : false);
        return { module : 'socket', 
             submodule : 'udp', 
             id : reqid,
             multiresp : cont, // multiresponse request
             method : method, 
             params : params};
    };

    var cli = function() {
        socketapi.exec(function(s) {
            if(s.error === undefined)
                  console.log("client socket.udp.openSocket no error");
            openedSockets += 1
            console.log('Opened socket! openedSockets: ', openedSockets)

            socketapi.exec(function(res) {
                if(res.error === undefined)
                      console.log("client socket.udp.udpConnect no error");

                socketapi.exec(function(res) {
                    if(res.error === undefined)
                          console.log("client socket.udp.send no error");

                    socketapi.exec(function(res) {
                        if(res.error === undefined)
                              console.log("client socket.udp.recv no error");
                        
                        if(res && res.data === "foo")
                              console.log("client socket.udp.recv got pong");

                        var stuff = getreq('close',[s]);
                        
                        socketapi.exec(function(res) {
                            if (res.error) {
                                console.error('Error when recvstop',res.error)
                            }
                            socketapi.exec(function() {
                                closedSockets+=1;
                                console.log('openedSockets',openedSockets) 
                                console.log('closedSockets',closedSockets)
                                console.log('openedSockets-closedSockets', openedSockets-closedSockets)
                                if (reqid < NUMBER_OF_CONNECTIONS) {
                                    timers.setTimeout(cli,30000/*ms*/);
                                    console.log("Scheduling reqid "+reqid)
                                } else {
                                    stopServer = true;
                                    console.log("Set stop server")
                                }
                            }, stuff);
                        }, getreq('udpRecvStop',[s]),manifest);
                    },getreq('recv',[s,true,2000]),manifest);
                },getreq('send',[s,"foo"]),manifest);       
            }, getreq('udpConnect',[s, "127.0.0.1", 9797]),manifest);
        }, getreq('udpOpen',[]),manifest);  
    };

    timers.setTimeout(cli,0);
    // start server
    // socketapi.exec(function(s) {
    //     if(s.error === undefined)
    //           console.log("server socket.udp.openSocket no error");

    //     console.log('server udpOpen')
    //     var stimer = undefined;
    //     var serverclose = function(ok) {
    //         console.log('server close')

    //         if (stimer)
    //             timers.clearTimeout(stimer);
    //         stimer = undefined;
    //         socketapi.exec(function(res) {
    //             socketapi.exec(function() {}, getreq('close',[s]));
    //             done(); 
    //         }, getreq('udpRecvStop',[s]),manifest);
    //     };

    //     socketapi.exec(function(res) {
    //         if(res.error === undefined)
    //               console.log("server socket.udp.udpBind no error");

    //         console.log('server udpBind')

    //         // start client side and listen for responses
    //         timers.setTimeout(cli,0);

    //         socketapi.exec(function(res) {
    //             console.log('server udpRecvFromStart')
    //             if(res.error === undefined)
    //                 console.log("server socket.udp.udpRecvFromStart no error");
                
    //             if (res.data && res.data === "foo") { // got ping - send pong
    //                 console.log("server socket.udp.udpRecvFromStart got ping");

    //                 // add the host to the server list so that we can send
    //                 // data back
    //                 manifest.neighbors['server'] = {};
    //                 manifest.neighbors['server'][res.address] = true;

    //                 socketapi.exec(function(res) {
    //                     if(res.error === undefined)
    //                           console.log("server socket.udp.udpSendTo no error");

    //                     console.log('server sendTo')

    //                     if (stopServer)
    //                         stimer = timers.setTimeout(serverclose, 5000);

    //                 }, getreq('udpSendTo',[s,res.data,res.address,res.port]),manifest);
    //             }

    //         }, getreq('udpRecvFromStart', [s, true], true),manifest);
    //     }, getreq('udpBind',[s, 0, 9797, true]),manifest);
    // }, getreq('udpOpen',[]),manifest);
};
