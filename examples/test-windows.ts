import * as os from "os";
import CWMPSimulator from "../src/cwmp-sim.js";
import CWMPDevice from "../src/cwmp-device.js";

// Custom Windows Data Model Extension
function populateWindowsData(device: CWMPDevice) {
  const rootName = Object.keys(device._rootTree)[0]; // "Device" or "InternetGatewayDevice"
  const isTR181 = rootName === "Device";

  // 1. DeviceInfo Population
  const deviceInfoPath = `${rootName}.DeviceInfo`;

  // Uptime
  const uptime = Math.floor(os.uptime());
  device.set(`${deviceInfoPath}.UpTime`, String(uptime));

  // Memory (Custom / Vendor specific potentially, or standard params if they exist)
  // TR-181 has Device.DeviceInfo.MemoryStatus.
  // TR-098 doesn't have standard memory in DeviceInfo usually.

  if (isTR181) {
    // Add MemoryStatus object if missing
    const memPath = `${deviceInfoPath}.MemoryStatus`;
    if (!device.findNode(memPath)) {
      // Manually creating structure for now
      device._rootTree[rootName].DeviceInfo["MemoryStatus"] = {
        _writable: false,
        Total: { _value: String(Math.floor(os.totalmem() / 1024)), _type: "xsd:unsignedInt", _writable: false },
        Free: { _value: String(Math.floor(os.freemem() / 1024)), _type: "xsd:unsignedInt", _writable: false }
      };
    } else {
      device.set(`${memPath}.Total`, String(Math.floor(os.totalmem() / 1024)));
      device.set(`${memPath}.Free`, String(Math.floor(os.freemem() / 1024)));
    }
  }

  // Hostname
  const hostname = os.hostname();
  // Assuming writable provisioning code or just logging it
  console.log(`Windows Hostname: ${hostname}`);

  // CPU Info
  const cpus = os.cpus();
  const model = cpus[0].model;
  device.set(`${deviceInfoPath}.ModelName`, model); // Standard param

  // 2. Network Interfaces (Ethernet & IP)
  // TR-181: Device.Ethernet.Interface.{i}.
  // TR-181: Device.IP.Interface.{i}.IPv4Address.{i}.
  if (isTR181) {
    const interfaces = os.networkInterfaces();
    let ethIndex = 1;

    // Ensure skeletons exist
    if (!device._rootTree[rootName]["Ethernet"])
      device._rootTree[rootName]["Ethernet"] = { _writable: false, Interface: { _writable: false } };
    if (!device._rootTree[rootName]["IP"])
      device._rootTree[rootName]["IP"] = { _writable: false, Interface: { _writable: false } };

    for (const [name, netIfs] of Object.entries(interfaces)) {
      // Filter loopback?
      const validIf = netIfs?.find((iface) => !iface.internal && iface.family === "IPv4");
      if (!validIf) continue;

      // Ethernet Interface
      const ethPath = `${rootName}.Ethernet.Interface.${ethIndex}`;
      device._rootTree[rootName].Ethernet.Interface[ethIndex] = {
        _writable: false,
        Enable: { _value: "true", _type: "xsd:boolean", _writable: false },
        Status: { _value: "Up", _type: "xsd:string", _writable: false },
        MACAddress: { _value: validIf.mac, _type: "xsd:string", _writable: false },
        MaxBitRate: { _value: "1000", _type: "xsd:unsignedInt", _writable: false } // Mock
      };

      // IP Interface
      const ipPath = `${rootName}.IP.Interface.${ethIndex}`;
      device._rootTree[rootName].IP.Interface[ethIndex] = {
        _writable: false,
        Enable: { _value: "true", _type: "xsd:boolean", _writable: false },
        IPv4Address: {
          _writable: false,
          1: {
            _writable: false,
            IPAddress: { _value: validIf.address, _type: "xsd:string", _writable: false },
            SubnetMask: { _value: validIf.netmask, _type: "xsd:string", _writable: false },
            AddressingType: { _value: "Static", _type: "xsd:string", _writable: false }
          }
        }
      };

      console.log(`Mapped Interface ${name}: MAC=${validIf.mac}, IP=${validIf.address}`);
      ethIndex++;
    }

    // Update counts (mock)
    device._rootTree[rootName].Ethernet.InterfaceNumberOfEntries = {
      _value: String(ethIndex - 1),
      _type: "xsd:unsignedInt",
      _writable: false
    };
    device._rootTree[rootName].IP.InterfaceNumberOfEntries = {
      _value: String(ethIndex - 1),
      _type: "xsd:unsignedInt",
      _writable: false
    };
  }
}

// Start Simulator
const client = new CWMPSimulator({
  acs: {
    url: "http://10.10.10.2:7547/acs",
    user: "",
    pass: ""
  },
  conn: {
    ssl: false,
    addr: "0.0.0.0",
    port: 7548,
    user: "",
    pass: ""
  },
  // It's all fleet: one group of one device (built-in TR-181 tree).
  fleet: {
    groups: [
      {
        count: 1,
        device: {
          rootName: "Device",
          serialNumber: "WIN-SIM-001",
          oui: "00E0FC",
          productClass: "WindowsSimulator"
        }
      }
    ]
  }
});

// Populate Data
populateWindowsData(client._devices[0]);

// Start
client.start();

console.log("Windows Simulator started.");
console.log(`  OS: ${os.type()} ${os.release()} ${os.platform()}`);
console.log(`  Memory: ${Math.round(os.totalmem() / 1024 / 1024)} MB`);
