const CWMPDiagnostics = require('../src/cwmp-diag');

// Mock Device
const mockDevice = {
  rootName: 'Device',
  data: {
    'Device.IP.Diagnostics.IPPing.Host': '8.8.8.8',
    'Device.IP.Diagnostics.IPPing.NumberOfRepetitions': '4',
    'Device.IP.Diagnostics.IPPing.Timeout': '1000',
    'Device.IP.Diagnostics.IPPing.DataBlockSize': '32',

    'Device.IP.Diagnostics.TraceRoute.Host': '8.8.8.8',
    'Device.IP.Diagnostics.TraceRoute.MaxHopCount': '15', // Short for test
    'Device.IP.Diagnostics.TraceRoute.Timeout': '1000'
  },
  getValue: function (path) {
    return this.data[path];
  },
  set: function (path, value) {
    console.log(`[SET] ${path} = ${value}`);
    this.data[path] = value;
  }
};

const diag = new CWMPDiagnostics(mockDevice);

console.log("--- Testing Ping ---");
diag.doPing();

// Wait a bit and test Tracert
setTimeout(() => {
  console.log("\n--- Testing Traceroute ---");
  diag.doTraceroute();
}, 5000);
