var rp = require('request-promise');
var fs = require('fs');

var express = require('express');
var app = express();

//IRI version fetcher
function fetchLatestIRIRelease(){
  rp({uri: 'https://github.com/iotaledger/iri/releases/latest', resolveWithFullResponse: true}).then((res) => {
      var path = res.request.uri.path.split("/")
      var latestVersion = path[path.length-1]

      //sanity check version string
      if(latestVersion.slice(0).replace(/^v(\d+\.)*(\*|\d+)$/, "").length != 0){
        console.log("Latest iri version sanity check failed. Version string is:", latestVersion)
        return;
      }

      var versionObject = {
        timestamp: Date.now(),
        version: latestVersion.slice(1) //remove v from vX.X.X
      }

      fs.writeFile("latest-iri-version.json", JSON.stringify(versionObject), function(err){
        if(err)
          console.log("I/O error when writing file:", err);
        else
          console.log("Wrote latest iri version to file:", latestVersion)
      })
  }).catch((err) => {
    console.log("Github version fetch request failed with error:", err)
  })
}
fetchLatestIRIRelease()

//Check nodes in list and collect info
function checkLightNodeServers(){
  //read light node server list
  var nodeListPromises = JSON.parse(fs.readFileSync('nodelist.json')).map((nodeUri) => {
    return rp({
      method: "POST",
      uri: nodeUri,
      body: {command: "getNodeInfo"},
      json: true,
      resolveWithFullResponse: true,
      time: true
    })
  }).map(p => p.catch(e => e)) //To allow use of promise.all

  Promise.all(nodeListPromises).then((completedPromises) => {
    var preppedForWrite = completedPromises.map((cp) => {
      //cp is response object or error object
      var url = cp.request.uri.href;

      if(cp.requestError){
        //no or bad response
        return {uri: url, ok: false}
      }else{
        try{
          var nodeInfo = cp.body
          if(!nodeInfo.appVersion)
            throw "Bad response";

          return {uri: url, ok: true, nodeInfo: nodeInfo, responseTime: cp.elapsedTime, timestamp: Date.now()}
        }catch(e){
          console.log("Bad node response from: ", url)
          console.log(cp.body)
          return {uri: url, ok: false}
        }
      }
    });

    fs.writeFile("nodelist-checks.json", JSON.stringify(preppedForWrite), function(err){
      if(err)
        console.log("I/O error when writing file:", err);
      else
        console.log("Wrote node list to file")
    })

  }).catch((err) => {
    console.log("Light node servers check failed with error:", err)
  })
}
checkLightNodeServers()


setInterval(fetchLatestIRIRelease, 1000*60*10) //ten minutes
setInterval(checkLightNodeServers, 1000*60*10) //ten minutes

app.use('/providers-skinny.json', (req, res) => {
  res.send(JSON.stringify(
              JSON.parse(fs.readFileSync('nodelist-checks.json')).map(n => n.uri)
          ))
});
app.use('/providers-full.json', (req, res) => {
  var providerList = JSON.parse(fs.readFileSync('nodelist-checks.json'));
  var latestVersionInfo = JSON.parse(fs.readFileSync("latest-iri-version.json"));


  res.send(JSON.stringify({versionInfo: latestVersionInfo, providers: providerList}))
});

app.use('/providers-ok-skinny.json', (req, res) => {
  res.send(JSON.stringify(
              JSON.parse(fs.readFileSync('nodelist-checks.json')).filter(n => n.ok == true).map(n => n.uri)
          ))
});

app.use('/providers-ok-updated-skinny.json', (req, res) => {
  var latestVersion = JSON.parse(fs.readFileSync("latest-iri-version.json")).version;

  res.send(JSON.stringify(
              JSON.parse(fs.readFileSync('nodelist-checks.json')).filter(n => n.ok == true).filter(n => n.nodeInfo && n.nodeInfo.appVersion == latestVersion).map(n => n.uri)
          ))
});

app.use('/providers-ok-updated-skinny-sorted.json', (req, res) => {
  var latestVersion = JSON.parse(fs.readFileSync("latest-iri-version.json")).version;

  res.send(JSON.stringify(
              JSON.parse(fs.readFileSync('nodelist-checks.json')).filter(n => n.ok == true).filter(n => n.nodeInfo && n.nodeInfo.appVersion == latestVersion).sort((n, n2) => {
                if(n.latestSolidSubtangleMilestoneIndex == n2.latestSolidSubtangleMilestoneIndex)
                  return n.responseTime - n2.responseTime; //sort by lowest response time
                else
                  return n2.latestSolidSubtangleMilestoneIndex - n.latestSolidSubtangleMilestoneIndex; //sort by highest milestone
              }).map(n => n.uri)
          ))
});

app.use(express.static('public'))
app.listen(8000)
