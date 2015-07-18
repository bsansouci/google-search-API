var request = require("request");
var exec = require('child_process').exec;
var jar = request.jar();
request = request.defaults({jar:jar});

var async = require("async");
var cheerio = require("cheerio");
var fs = require("fs");
var readline = require('readline');

function get(url, jar, qs, callback) {
  if(typeof qs === "function") {
    callback = qs;
    qs = {};
  }

  var op = {
    headers: {
      'Content-Type' : 'application/x-www-form-urlencoded',
      'Referer' : 'https://www.google.ca/',
      'Host' : url.replace('https://', '').split("/")[0],
      'Origin' : 'https://www.google.ca',
      'User-Agent' : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_2) AppleWebKit/600.3.18 (KHTML, like Gecko) Version/8.0.3 Safari/600.3.18',
      'Connection' : 'keep-alive',
    },
    timeout: 60000,
    qs: qs,
    url: url,
    method: "GET",
    jar: jar,
    gzip: true
  };

  return request(op, callback);
}

var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function arrayToObject(arr, getKey, getValue) {
  return arr.reduce(function(acc, val) {
    acc[getKey(val)] = getValue(val);
    return acc;
  }, {});
}

function arrToForm(form) {
  return arrayToObject(form, function(v) {return v.name;}, function(v) {return v.val;});
}


function saveCookies(jar, res) {
  var cookies = res.headers['set-cookie'] || [];
  cookies.map(function (c) {
    jar.setCookie(c, "https://www.google.ca");
  });
  return res;
}

function loop503(body, cb) {
  var $ = cheerio.load(body);
  var imageUrl = "http://www.google.ca" + $('img').attr('src');
  var arr = [];
  $("form input").map(function(i, v){
    arr.push({val: $(v).val(), name: $(v).attr("name")});
  });
  arr = arr.filter(function(v) {
    return v.val && v.val.length;
  });

  var form = arrToForm(arr);
  console.log("getting image", imageUrl);
  request.get(imageUrl, {encoding: 'binary'}, function(err, res, body) {
    var type = res.headers['content-type'].split('/');
    if(type[0] !== 'image') throw new Error("Problem, content-type of image req was " + JSON.stringify(type));

    saveCookies(jar, res);
    fs.writeFile('captcha.' + type[1], body, 'binary', function(err){
      if (err) throw err;
      exec('open captcha.' + type[1], function(error, stdout, stderr) {
        rl.question('Please enter this captcha bellow: ' + "\n> ", function(answer) {
          if (err) return cb(err);
          form.captcha = answer;

          get('https://www.google.ca/sorry/CaptchaRedirect', jar, form, function(err, res, body) {
            if(err) cb(err);
            console.log("done req sorry/CaptchaRedirect", res.statusCode);
            if(res.statusCode === 503) {
              loop503(body, cb);
            } else {
              cb(null, res, body);
            }
          });
        });
      });
    });
  });
}

function searchFor(searchQuery, pageNum, callback) {
  var magic = new Array(pageNum);
  for (var i = 0; i < magic.length; i++) {
    magic[i] = i;
  }
  async.mapLimit(magic, 1, function(i, cb) {
    console.log("getting", "https://www.google.ca/search?sclient=psy-ab&site=&source=hp&btnG=Search&q=" + searchQuery + "&start=" + i * 10);
    get("https://www.google.ca/search?sclient=psy-ab&site=&source=hp&btnG=Search&q=" + searchQuery + "&start=" + i * 10, jar, function(err, res, body) {
      if(err) return cb(err);

      console.log(res.statusCode);
      if(res.statusCode === 503) {
        fs.writeFileSync('test.html', body);
        return loop503(body, function(err, res, body) {
          if (err) return cb(err);

          console.log('Writing', searchQuery + "-page" + i + ".html");
          fs.writeFileSync(searchQuery.replace(/[\/ !@#$%^&*<>]/g, "") + "-page" + i + ".html", body);
          cb(null);
        });
      }
      console.log('Writing', searchQuery + "-page" + i + ".html");
      fs.writeFileSync(searchQuery.replace(/[\/ !@#$%^&*<>]/g, "") + "-page" + i + ".html", body);
      return cb(null);
    });
  }, function(err) {
    callback(err);
  });
}

var pageNum = 3;
var arr = fs.readFileSync("searchTerms.txt", 'utf8').split("\r\n").map(function(v) {return v.split(" ").join("+");});

get('https://www.google.ca', jar, function(err, res, body) {
  async.mapLimit(arr, 1, function(v, cb) {
    searchFor(v, pageNum, cb);
  }, function(err) {
    if(err) throw err;
    console.log("Done");
    rl.close();
  });
});
