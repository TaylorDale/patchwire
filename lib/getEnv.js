module.exports = function getenv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined && defaultValue === undefined)
    throw Error(`Value for environment variable ${name} required `);
  return (value || defaultValue);
}
