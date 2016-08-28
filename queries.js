const Promise = require('bluebird');
const path = require('path');
const config = require('./config');
const jwt              = require('jsonwebtoken');
const bcrypt = require('bcrypt');

Promise.config({ cancellation: true });

// Initialization Options for pg-promise
const options = { promiseLib:  Promise };

// Connection Params for pg-promise
const connectionParams = {
    host: 'localhost',
    port: 5432,
    database: 'modify',
    user: config.postgreStore.username,
    password: config.postgreStore.password,
};

const pgp = require('pg-promise')(options);
const db = pgp(connectionParams);

// Helper for linking to external query files:  
function sql(file) {
    const fullPath = path.join(__dirname, file);
    return new pgp.QueryFile(fullPath, {debug: true});
}

// Create QueryFile globally, once per file: 
const sqlFindModule = sql('./sql/module.sql');
const sqlModuleList = sql('./sql/module_list.sql');
const sqlFindUserById = sql('./sql/find_local_by_id.sql');
const sqlFindUserByEmail = sql('./sql/find_local_by_email.sql');
const sqlInsertUser = sql('./sql/insert_local_user.sql');
const sqlUsersList = sql('./sql/users_list.sql');

// Schema for common fields
const checkSchema = {
 'school': {
    notEmpty: true,
    matches: {
      // case insensitve
      options: ['NTU|NUS', 'i']
    },
    errorMessage: 'Invalid school, must be NTU or NUS',
  },
  'year': {
    notEmpty: true,
    isInt: {
      options: [{ min: 2010, max: 2050 }],
    },
    errorMessage: 'Invalid year, must be between 2010 and 2050',
  },
  'sem': {
    notEmpty: true,
    isInt: {
      options: [{ min: 1, max: 4 }],
    },
    errorMessage: 'Invalid sem, must be 1 - 4',
  },
};

function respondWithErrors(errors, res) {
  const response = { errors: [] };
  errors.forEach(err => {
    response.errors.push(err.msg);
  });
  res.statusCode = 400;
  return res.json(response);
}

const bcryptCompareAsync = Promise.promisify(bcrypt.compare);
const jwtSignAsync = Promise.promisify(jwt.sign);

function getSingleModule(req, res, next) {
  req.checkParams(checkSchema);
  req.checkParams('code', 'Must be between 2 and 10 chars long')
    .notEmpty().isLength({ min: 2, max: 10 })
    .isAlphanumeric();
  
  const errors = req.validationErrors();
  if (errors) {
    return respondWithErrors(errors, res);
  }

  const school = req.params.school.toUpperCase();
  const year = parseInt(req.params.year, 10);
  const sem = parseInt(req.params.sem, 10);
  const code = req.params.code.toUpperCase();

  db.one(sqlFindModule, {school, year, sem, code})
    .then(function (data) {
      res.status(200).json(data);
    })
    .catch(function (error) {
      // output no data as 404 instead of 500
      if (error.result &&
        'rowCount' in error.result &&
        error.result.rowCount === 0) {
        error.status = 404;
      }
      return next(error);
    });
}

function getModulesList(req, res, next) {
  req.checkParams(checkSchema);
  
  const errors = req.validationErrors();
  if (errors) {
    return respondWithErrors(errors, res);
  }

  const school = req.params.school.toUpperCase();
  const year = parseInt(req.params.year, 10);
  const sem = parseInt(req.params.sem, 10);

  db.any(sqlModuleList, {school, year, sem})
    .then(function (data) {
      res.status(200).json(data);
    })
    .catch(function (error) {
      return next(error);
    });
}

function getUsersList(req, res, next) {
   db.any(sqlUsersList)
    .then(function (data) {
      res.status(200).json(data);
    })
    .catch(function (error) {
      return next(error);
    });
}

function getSingleUserById(id) {
  return db.one(sqlFindUserById, { id });
}

function authenticateLocalUser(req, res, next) {
  const email = req.body.email;
  const password = req.body.password;
  
  const findUser = db.oneOrNone(sqlFindUserByEmail, { email });
  const authenticateUser = findUser.then((user) => {
    if (!user) {
      return Promise.reject('Authentication failed. User not found.');
    }
    return bcryptCompareAsync(password, user.password);
  });
  
  Promise.join(findUser, authenticateUser, (user, isPasswordCorrect) => {
    if (!isPasswordCorrect) {
      return Promise.reject('Authentication failed. Wrong password.');
    }
    // generate a json web token (jwt)
    return jwtSignAsync({ id: user.id }, config.secret, { expiresIn: '1m' });
  })
  .then((token) => {
    // if everything passes, output a token
    // TODO: put token in cookie instead
    res.json(token);
  })
  .catch((error) => {
    res.status(401).json({ error });  // not authorized and output reason
  });
}

function setSingleUser(email, password) {
  return db.one(sqlInsertUser, { email, password });
}

module.exports = {
  getSingleModule,
  getModulesList,
  getSingleUserById,
  authenticateLocalUser,
  setSingleUser,
  getUsersList,
};
