/**
 * Module dependencies
 */

var mongoose = require('mongoose');
var crypto = require('crypto');
var nodemailer = require("nodemailer");
var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;

/**
 * Schemas
 */

var Schema = mongoose.Schema;

var Profile = new Schema({
    login: { type: String, unique: true, required: true },
    email: { type: String, required: true },
    passwd: { type: String, required: true },
    fullname: { type: String },
    date: { type: Date, required: true },
    courses: [ String ]
});

var Activation = new Schema({
    email: { type: String, required: true },
    key: { type: String, required: true },
    passwd: { type: String, required: true },
    date: { type: Date, required: true }
});

ProfileModel = mongoose.model('Profile', Profile);
ActivationModel = mongoose.model('Activation', Activation);

/**
 * Lib
 */

var toHash = function(str) {
    return crypto.createHash('sha1').update(str).digest('hex');
};

/**
 * Auth
 */

passport.serializeUser(function(userid, done) {
    done(null, userid);
});

passport.deserializeUser(function(userid, done) {
    done(null, userid);
});

passport.use(new LocalStrategy({
    usernameField: 'login',
    passwordField: 'passwd'
},
function(username, password, done) {
    ProfileModel.findOne({login: username}, function(err, data) {
        if (!err && data && data.passwd === toHash(password)) {
            return done(null, data.login);
        } else {
            return done(err);
        }
    });
}
));

/**
 * Schedule
 */

var cronJob = require('cron').CronJob;
var job = new cronJob({
    cronTime: '00 00 * * * *', // every hour
    onTick: function() {
        // Delete records that are older one hour
        var d = new Date();
        d.setHours(d.getHours()-1);
        ActivationModel.remove({date: {"$lt": d}});
    },
    start: false
    //timeZone: "Europe/Moscow"
});
job.start();

/*
 * Serve JSON to our AngularJS client
 */

// Get profile variables
exports.check = function(req, res) {
    ProfileModel.find({login: req.params.login}, function(err, data) {
        if (!err) {
            if (data)
                res.send(200); // 200 OK
            else
                res.send(404); // 404 Not Found
        } else {
            res.send(500); // 500 Internal Server Error
            console.log(err);
        }
    });
};

// Get profile variables
exports.get = function(req, res) {
    var userid = req.session.passport.user;
    if (!userid)
        return res.send(401); // 401 Unauthorized

    ProfileModel.findOne({login: userid}, function(err, data) {
        if (!err) {
            data.passwd = '';
            res.json(data); // 200 OK + data
        } else {
            res.send(500); // 500 Internal Server Error
            console.log(err);
        }
    });
};

// Update profile variables
exports.update = function(req, res) {
    var userid = req.session.passport.user;
    if (!userid)
        return res.send(401); // 401 Unauthorized
    
    var profile = {};
    /*
    if (req.body.login) {
        profile.login = req.body.login;
    }
    */
    if (req.body.email) {
        profile.email = req.body.email;
    }
    if (req.body.passwd) {
        profile.passwd = req.body.passwd;
    }
    if (req.body.fullname) {
        profile.fullname = req.body.fullname;
    }
    if (req.body.courses) {
        profile.courses = req.body.courses;
    }

    ProfileModel.findOneAndUpdate({login: userid}, profile, function(err) {
        if (!err) {
            res.send(200); // 200 OK
        } else {
            res.send(500); // 500 Internal Server Error
            console.log(err);
        }
    });
};

// Remove profile variables
exports.remove = function(req, res) {
    var userid = req.session.passport.user;
    if (!userid)
        return res.send(401); // 401 Unauthorized
    
    ProfileModel.remove({login: userid}, function(err) {
        if (!err) {
            res.send(200); // 200 OK
        } else {
            res.send(500); // 500 Internal Server Error
            console.log(err);
        }
    });
};

// New user registration
exports.register = function(req, res) {
    if (!req.body.login || !req.body.email || !req.body.passwd)
        return res.send(400); // 400 Bad Request
    // Validating login
    if (!/^[a-zA-Z0-9]+$/.test(req.body.login))
        return res.send(400); // 400 Bad Request
    // Validating email
    if (!/\S+@\S+\.\S+/.test(req.body.email))
        return res.send(400); // 400 Bad Request
    // Checking password lenght
    if (req.body.passwd.length < 4)
        return res.send(400); // 400 Bad Request
    
    var newProfile = new ProfileModel({
        login: req.body.login,
        email: req.body.email,
        passwd: toHash(req.body.passwd),
        fullname: req.body.fullname,
        date: new Date(),
        courses: []
    });
    newProfile.save(function(err, data) { 
        if (!err) {
            req.session.passport.user = data.login;
            res.send(200); // 200 OK
        } else {
            // if user exists (dublicate)
            res.send(403); // 403 Forbidden
        }
    });
};

// Sign In
exports.login = function(req, res, next) {
    passport.authenticate('local', function(err, user, info) {
        if (err) {
            return next(err);
        }
        if (!user) {
            return res.send(401); // 401 Unauthorized
        }
        req.logIn(user, function(err) {
            if (err) {
                return next(err);
            }
            return res.send(200); // 200 OK
        });
    })(req, res, next);
};

/*
// Simple sign in method
exports.login = function(req, res) {
    if (!req.body.email || !req.body.passwd)
        return res.send(400);
    
    ProfileModel.findOne({email: req.body.email}, function(err, profile) {
        var passwd = crypto.createHash('sha1').update(req.body.passwd).digest('hex');
        if (!err && profile && profile.passwd === passwd) {
            req.session.userid = profile._id;
            return exports.getProfile(req, res);
        } else {
            return res.send(403);
        }
    });
};
*/

// Reset password
exports.reset = function(req, res) {
    if (!req.body.email)
        return res.send(400); // 400 Bad Request
    // Validating email
    var re = /\S+@\S+\.\S+/;
    if (!re.test(req.body.email)) {
        return res.send(400); // 400 Bad Request
    }
    // Send mail function
    var sendMail = function(email, fullname, passwd, activation) {
        // create reusable transport method (opens pool of SMTP connections)
        var smtpTransport = nodemailer.createTransport("SMTP", {
            host: "192.168.0.12",
            auth: {
                user: "robot@cde.ifmo.ru",
                pass: ""
            }
        });
        // setup e-mail data with unicode symbols
        var mailOptions = {
            from: "openITMO <robot@cde.ifmo.ru>",
            to: email,
            subject: "reset password",
            text: "Hello, " + fullname + // plaintext body
                "!\n\nYour new password: " + passwd +
                "\nActivation number: " + activation
            //html: "<b>Hello world ✔</b>" // html body
        };
        // send mail with defined transport object
        smtpTransport.sendMail(mailOptions, function(err, response) {
            if (err) {
                console.log(err);
            } else {
                console.log("Message sent: " + response.message);
            }
            smtpTransport.close(); // shut down the connection pool, no more messages
        });
    };
    
    var email = req.body.email;
    var key = req.body.key;
    if (!key) {
        // Generate password and activation key
        ProfileModel.findOne({email: email}, function(err, data) {
            if (!err) {
                if (!data)
                    return res.send(404);
                // Generate random password
                var passwd = Math.random().toString(36).slice(-8);
                var activation = Math.floor(Math.random() * 900000) + 100000;
                var newActivation = new ActivationModel({
                    email: data.email,
                    key: activation,
                    passwd: toHash(passwd),
                    date: new Date
                });
                newActivation.save(function(err) {
                    if (!err) {
                        sendMail(data.email, data.fullname, passwd, activation);
                    } else {
                        console.log(err);
                    }
                });
                return res.send(200); // 200 OK
            } else {
                console.log(err);
                return res.send(500); // 500 Internal Server Error
            }
        });
    } else {
        ActivationModel.find({email: email, key: key}, null, {sort: {date: -1}}, function(err, data) {
            if (!err) {
                if (data.length <= 0)
                    return res.send(404); // 404 Not Found
                // Update user password
                ProfileModel.findOneAndUpdate({email: email}, {passwd: data[0].passwd}, function(err) {
                    if (!err) {
                        return res.send(200); // 200 OK
                    } else {
                        console.log(err);
                        return res.send(500); // 500 Internal Server Error
                    }
                });
            } else {
                console.log(err);
                return res.send(500); // 500 Internal Server Error
            }
        });
    }
};

// Logout
exports.logout = function(req, res) {
    if (req.session) {
        req.session.destroy(function() {
            return res.send(200); // 200 OK
        });
    }
};
