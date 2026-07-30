const Joi = require("joi");

// Generic validator factory. Validates req.body against a Joi schema and
// returns a 400 with a clear message when the payload is malformed.
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: error.details.map((d) => d.message),
    });
  }
  req.body = value;
  next();
};

const { ALL_ROLES } = require("./roles");

const roles = ALL_ROLES;

const createUserSchema = Joi.object({
  firstName: Joi.string().trim().min(1).max(100).required(),
  lastName: Joi.string().trim().min(1).max(100).required(),
  designation: Joi.string().trim().max(100).allow("", null),
  email: Joi.string().email().required(),
  mobile: Joi.string().trim().max(20).allow("", null),
  password: Joi.string().min(4).max(100).required(),
  role: Joi.string().valid(...roles).required(),
  supervisor: Joi.alternatives(Joi.number(), Joi.string().allow(""), null),
  status: Joi.string().valid("active", "inactive"),
});

const updateUserSchema = Joi.object({
  firstName: Joi.string().trim().min(1).max(100),
  lastName: Joi.string().trim().min(1).max(100),
  designation: Joi.string().trim().max(100).allow("", null),
  email: Joi.string().email(),
  mobile: Joi.string().trim().max(20).allow("", null),
  password: Joi.string().min(4).max(100),
  role: Joi.string().valid(...roles),
  supervisor: Joi.alternatives(Joi.number(), Joi.string().allow(""), null),
  status: Joi.string().valid("active", "inactive"),
}).min(1);

const taskSchema = Joi.object({
  taskId: Joi.string().max(50),
  title: Joi.string().trim().min(1).max(500).required(),
  associatedLead: Joi.string().max(255).allow("", null),
  description: Joi.string().allow("", null),
  originalDueDate: Joi.string().max(20).allow("", null),
  dueDate: Joi.string().max(20).allow("", null),
  priority: Joi.string().max(20).allow("", null),
  category: Joi.string().max(50).allow("", null),
  status: Joi.string().max(20).allow("", null),
});

module.exports = {
  validate,
  createUserSchema,
  updateUserSchema,
  taskSchema,
};
