module.exports = {
  activate(context) {
    return {
      pluginId: context?.manifest?.id || 'simple-widget',
      status: 'ready'
    };
  }
};
