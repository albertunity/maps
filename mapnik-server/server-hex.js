var mapnik = require('mapnik')
  , mercator = require('./sphericalmercator')
  , request = require('request')
  , async = require('async')
  , http = require('http')
  , url = require('url')
  , fs = require('fs')
  , tilelive = require('tilelive')
  , carto = require('carto')
  , parser = require('./cartoParser');

// configure tilelive to use tilejson services to locate vector tiles
require('tilejson').registerProtocols(tilelive);

function isEmpty(obj) {
  for(var prop in obj) {
    if(obj.hasOwnProperty(prop))
      return false;
  }
  return true;
}

var server = http.createServer(function(req, res) {

  var query = url.parse(req.url.toLowerCase(), true).query;

  if (!query || isEmpty(query)) {
    try {
      res.writeHead(200, {
        'Content-Type': 'text/html'
      });

      // support a basic asset server
      if (req.url == '/') {
        res.end(fs.readFileSync('./public/index.html'));
      } else {
        res.end(fs.readFileSync('./public/' + req.url));
      }
    } catch (err) {
      res.writeHead(500, {
        'Content-Type': 'text/plain'
      });
      res.end('Not found: ' + req.url);
    }
  } else {

    if (query &&
        query.x !== undefined &&
        query.y !== undefined &&
        query.z !== undefined
    ) {

      // TODO: of course...
      //var tilejsonURL = "tilejson+http://localhost:7001/api/all.json";
      // timeout can be added in the tilejson response? TODO...
      var tilejsonURL = "tilejson+http://localhost:7001/api/hex/all.json?timeout=30000";
      var cartoURL = "http://localhost:3000/gbif-hex.mss"
      //var cartoURL = "http://localhost:3000/gbif-hot.mss"

      console.time("getAssets");

      // Collect the CartoCSS styling document, metadata about the tiles and generate the image using mapnik
      async.parallel({
        // load the carto CSS
        carto: function(callback) {
          request.get(cartoURL, function (error, response, body) {
            if (!error && response.statusCode == 200) {
              callback(null, body)
            } else {
              callback(error)
            }
          })
        },

        // load the tilejson metadata
        tilejson: function(callback) {
          tilelive.load(tilejsonURL, function(err, source) {
            callback(err, source);
          })
        }

      }, function(err, results) {
        console.timeEnd("getAssets");
        if (err) throw err;

        // convert the carto into mapnik style
        var xmlStylesheet = parser.parseToXML([results.carto], results.tilejson);

        // load the tile which is located from the tilejson metadata
        console.time("getTile");

        results.tilejson.getTile(parseInt(query.z),parseInt(query.x),parseInt(query.y), function(err, tile, headers) {
          console.timeEnd("getTile");

          var map = new mapnik.Map(512, 512, mercator.proj4);
          map.fromStringSync(xmlStylesheet); // load in the style we parsed


          var vt = new mapnik.VectorTile(parseInt(query.z),parseInt(query.x),parseInt(query.y));
          if (tile) {
            vt.addDataSync(tile);
            //console.log(vt.tileSize, vt.bufferSize);

            //console.log(mapnik.VectorTile.info(tile));
            //var extent = vt.extent();
            //console.log(extent);

            // important to include a buffer, to catch the overlaps
            console.time("render");
            vt.render(map, new mapnik.Image(512,512), {"buffer_size":5}, function(err, image) {
              if (err) {
                res.end(err.message);
              } else {
                res.writeHead(200, {
                  'Content-Type': 'image/png'
                });
                image.encode('png', function(err,buffer) {
                  console.timeEnd("render");
                  if (err) {
                    res.end(err.message);
                  } else {
                    res.end(buffer);
                  }
                });
              }
            });
          } else {
            // no tile
            res.writeHead(404, {
              'Content-Type': 'image/png'
            });
            res.end();
          }
        })
      })


    } else {
      res.writeHead(500, {
        'Content-Type': 'text/plain'
      });
      res.end('missing x, y, z, sql, or style parameter');
    }
  }
});


server.listen(3000);