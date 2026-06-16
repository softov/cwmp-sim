"use strict";

const isPlainObject = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
const deepClone = (obj: any) => Object.fromEntries(
  Object.entries(obj).map(([k, v]) => [k, isPlainObject(v) ? deepClone(v) : v
  ])
);

const merge = (target: any, source: any) => {
  // If either side is not a plain object, source wins
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return isPlainObject(source) ? deepClone(source) : source;
  }
  const result: any = {};
  const keys = new Set([
    ...Object.keys(target),
    ...Object.keys(source)
  ]);

  for (const key of keys) {
    if (!(key in source)) {
      result[key] = merge(undefined, target[key]);
      continue;
    }

    result[key] = merge(target[key], source[key]);
  }

  return result;
};

// A starting point for port mapping parameters.
const portMappingDefaultParams = {
  'PortMappingEnabled': { _value: 'false', _type: 'xsd:boolean', _writable: true },
  'ExternalPort': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'InternalPort': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'InternalClient': { _value: '', _type: 'xsd:string', _writable: true },
  'ExternalPortEndRange': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'PortMappingLeaseDuration': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'PortMappingDescription': { _value: '', _type: 'xsd:string', _writable: true },
};

// Model specific port mapping parameters.
const portMappingTpLinkTr098Params = merge(portMappingDefaultParams, {
  'X_TP_ExternalPortEnd': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'X_TP_InternalPortEnd': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'ServiceName': { _value: '', _type: 'xsd:string', _writable: true },
  'PortMappingDescription': null,
});

const portMappingTpLinkTr181Params = merge(portMappingDefaultParams, {
  'PortMappingEnabled': null,
  'PortMappingDescription': null,

  'Enable': { _value: 'false', _type: 'xsd:boolean', _writable: true },
  'Protocol': { _value: '', _type: 'xsd:string', _writable: true },
  'Alias': { _value: '', _type: 'xsd:string', _writable: true },
  'RemoteHost': { _value: '', _type: 'xsd:string', _writable: true },
  'Interface': { _value: '', _type: 'xsd:string', _writable: true },
});

const portMappingHuaweiParams = merge(portMappingDefaultParams, {
  'X_HW_InternalEndPort': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
});

const portMappingMultilaserParams = merge(portMappingDefaultParams, {
  'X_ZTE-COM_InternalPortEndRange': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'RemoteHost': { _value: '', _type: 'xsd:string', _writable: true },
});

const portMappingNokiaParams = merge(portMappingDefaultParams, {
  'X_ASB_COM_InternalPortEnd': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'RemoteHost': { _value: '', _type: 'xsd:string', _writable: true },
});


const commonDeviceInfoParams = {
  'Manufacturer': { _value: 'BrByte', _type: 'xsd:string', _writable: false },
  'OUI': { _value: '00E0FC', _type: 'xsd:string', _writable: false },
  'ProductClass': { _value: 'Simulator', _type: 'xsd:string', _writable: false },
  'SerialNumber': { _value: '123456', _type: 'xsd:string', _writable: false },
  'SpecVersion': { _value: '1.0', _type: 'xsd:string', _writable: false },
  'HardwareVersion': { _value: '1.0', _type: 'xsd:string', _writable: false },
  'SoftwareVersion': { _value: '1.0.0', _type: 'xsd:string', _writable: false },
  'ProvisioningCode': { _value: '', _type: 'xsd:string', _writable: true },
  'DeviceStatus': { _value: 'Up', _type: 'xsd:string', _writable: false },
  'UpTime': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'FirstUseDate': { _value: '0001-01-01T00:00:00Z', _type: 'xsd:dateTime', _writable: false }
};

const commonManagementServerParams = {
  'URL': { _value: 'http://localhost:7547/acs', _type: 'xsd:string', _writable: true },
  'Username': { _value: 'cpe', _type: 'xsd:string', _writable: true },
  'Password': { _value: 'cpe', _type: 'xsd:string', _writable: true },
  'PeriodicInformEnable': { _value: '1', _type: 'xsd:boolean', _writable: true },
  'PeriodicInformInterval': { _value: '60', _type: 'xsd:unsignedInt', _writable: true },
  'PeriodicInformTime': { _value: '0001-01-01T00:00:00Z', _type: 'xsd:dateTime', _writable: true },
  'ParameterKey': { _value: '', _type: 'xsd:string', _writable: true },
  'ConnectionRequestURL': { _value: 'http://localhost:7547/', _type: 'xsd:string', _writable: false },
  'ConnectionRequestUsername': { _value: 'usertest', _type: 'xsd:string', _writable: true },
  'ConnectionRequestPassword': { _value: 'passtest', _type: 'xsd:string', _writable: true },
  'UpgradesManaged': { _value: '0', _type: 'xsd:boolean', _writable: true }
};

const wanIPConnectionDeviceParams = {
  'Enable': { _value: '1', _type: 'xsd:boolean', _writable: true },
  'ConnectionStatus': { _value: 'Connected', _type: 'xsd:string', _writable: false },
  'PossibleConnectionTypes': { _value: 'IP_Routed', _type: 'xsd:string', _writable: false },
  'ConnectionType': { _value: 'IP_Routed', _type: 'xsd:string', _writable: false },
  'Name': { _value: 'Internet', _type: 'xsd:string', _writable: true },
  'Uptime': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'ExternalIPAddress': { _value: '192.168.1.10', _type: 'xsd:string', _writable: false },
  'AddressingType': { _value: 'DHCP', _type: 'xsd:string', _writable: true },
  'SubnetMask': { _value: '255.255.255.0', _type: 'xsd:string', _writable: false },
  'DefaultGateway': { _value: '192.168.1.1', _type: 'xsd:string', _writable: false },
  'DNSServers': { _value: '8.8.8.8,8.8.4.4', _type: 'xsd:string', _writable: false },
  'MACAddress': { _value: '00:11:22:33:44:55', _type: 'xsd:string', _writable: false },
  'PortMappingNumberOfEntries': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'PortMapping': {
    _writable: true,
    funcObj: (device, defaultInfo, newInstanceId, parentNode) => {
      return merge(portMappingDefaultParams, defaultInfo);
    }
  } // Container for PortMapping instances
};

const wanConnectionDeviceParams = {
  'WANIPConnection': {
    '1': wanIPConnectionDeviceParams
  }
};

const wlanConfigurationParams = {
  'Enable': { _value: '1', _type: 'xsd:boolean', _writable: true },
  'Status': { _value: 'Up', _type: 'xsd:string', _writable: false },
  'BSSID': { _value: '00:11:22:33:44:66', _type: 'xsd:string', _writable: false },
  'SSID': { _value: 'BrByte_WiFi', _type: 'xsd:string', _writable: true },
  'Name': { _value: 'BrByte WiFi', _type: 'xsd:string', _writable: true },
  'Standard': { _value: 'n', _type: 'xsd:string', _writable: false },
  'Channel': { _value: '6', _type: 'xsd:unsignedInt', _writable: true },
  'AutoChannelEnable': { _value: '1', _type: 'xsd:boolean', _writable: true },
  'TransmitPower': { _value: '100', _type: 'xsd:unsignedInt', _writable: true },
  'BeaconType': { _value: 'WPAand11i', _type: 'xsd:string', _writable: true }, // None, Basic, WPA, 11i, WPAand11i
  'WPAEncryptionModes': { _value: 'TKIPandAESEncryption', _type: 'xsd:string', _writable: true },
  'KeyPassphrase': { _value: '12345678', _type: 'xsd:string', _writable: true },
};

// Vendor Specific WiFi Parameters (Examples)
const wlanConfigurationHuaweiParams = merge(wlanConfigurationParams, {
  'X_HW_WorkMode': { _value: 'AP', _type: 'xsd:string', _writable: true },
});

const wlanConfigurationZteParams = merge(wlanConfigurationParams, {
  'X_ZTE-COM_RFPowerState': { _value: '1', _type: 'xsd:boolean', _writable: true },
});

/**
 * Converts a simple model definition to the internal device structure.
 * @param {object} modelDef 
 * @returns {object} Internal structure { Property: { _value, _type, _writable } }
 */
function toInternalModel(modelDef): Record<string, any> {
  const internal: Record<string, any> = {};
  for (const key in modelDef) {
    const item = modelDef[key];
    // Pass through if already internal format (e.g. containers like PortMapping)
    if (item._writable !== undefined || item._value !== undefined || item._type !== undefined) {
      internal[key] = { ...item };
      continue;
    }

    internal[key] = {
      _value: item.value,
      _type: item.type,
      _writable: item.writable !== undefined ? item.writable : true
    };
  }
  return internal;
}


const ipPingDiagnosticsParams = {
  'DiagnosticsState': { _value: 'None', _type: 'xsd:string', _writable: true },
  'Interface': { _value: '', _type: 'xsd:string', _writable: true },
  'Host': { _value: '', _type: 'xsd:string', _writable: true },
  'NumberOfRepetitions': { _value: '3', _type: 'xsd:unsignedInt', _writable: true },
  'Timeout': { _value: '1000', _type: 'xsd:unsignedInt', _writable: true },
  'DataBlockSize': { _value: '32', _type: 'xsd:unsignedInt', _writable: true },
  'DSCP': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'SuccessCount': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'FailureCount': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'AverageResponseTime': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'MinimumResponseTime': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'MaximumResponseTime': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
};

const traceRouteDiagnosticsParams = {
  'DiagnosticsState': { _value: 'None', _type: 'xsd:string', _writable: true },
  'Interface': { _value: '', _type: 'xsd:string', _writable: true },
  'Host': { _value: '', _type: 'xsd:string', _writable: true },
  'NumberOfTries': { _value: '3', _type: 'xsd:unsignedInt', _writable: true },
  'Timeout': { _value: '5000', _type: 'xsd:unsignedInt', _writable: true },
  'DataBlockSize': { _value: '38', _type: 'xsd:unsignedInt', _writable: true },
  'DSCP': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'MaxHopCount': { _value: '30', _type: 'xsd:unsignedInt', _writable: true },
  'ResponseTime': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'RouteHopsNumberOfEntries': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'RouteHops': {
    _writable: false, // Container
    // RouteHops.i. is dynamic
  }
};

const downloadDiagnosticsParams = {
  'DiagnosticsState': { _value: 'None', _type: 'xsd:string', _writable: true },
  'Interface': { _value: '', _type: 'xsd:string', _writable: true },
  'DownloadURL': { _value: '', _type: 'xsd:string', _writable: true },
  'DSCP': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'EthernetPriority': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'TimeBasedTestDuration': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'TimeBasedTestMeasurementInterval': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'TimeBasedTestMeasurementOffset': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'ProtocolVersion': { _value: 'Any', _type: 'xsd:string', _writable: true },
  'NumberOfConnections': { _value: '1', _type: 'xsd:unsignedInt', _writable: true },
  'EnablePerConnectionResults': { _value: '0', _type: 'xsd:boolean', _writable: true },
  'ROMTime': { _value: '0001-01-01T00:00:00Z', _type: 'xsd:dateTime', _writable: false },
  'BOMTime': { _value: '0001-01-01T00:00:00Z', _type: 'xsd:dateTime', _writable: false },
  'EOMTime': { _value: '0001-01-01T00:00:00Z', _type: 'xsd:dateTime', _writable: false },
  'TestBytesReceived': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'TotalBytesReceived': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'TotalBytesSent': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'TCPOpenRequestTime': { _value: '0001-01-01T00:00:00Z', _type: 'xsd:dateTime', _writable: false },
  'TCPOpenResponseTime': { _value: '0001-01-01T00:00:00Z', _type: 'xsd:dateTime', _writable: false },
};

const uploadDiagnosticsParams = {
  'DiagnosticsState': { _value: 'None', _type: 'xsd:string', _writable: true },
  'Interface': { _value: '', _type: 'xsd:string', _writable: true },
  'UploadURL': { _value: '', _type: 'xsd:string', _writable: true },
  'DSCP': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'EthernetPriority': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'TestFileLength': { _value: '1000000', _type: 'xsd:unsignedInt', _writable: true },
  'TimeBasedTestDuration': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'TimeBasedTestMeasurementInterval': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'TimeBasedTestMeasurementOffset': { _value: '0', _type: 'xsd:unsignedInt', _writable: true },
  'ProtocolVersion': { _value: 'Any', _type: 'xsd:string', _writable: true },
  'NumberOfConnections': { _value: '1', _type: 'xsd:unsignedInt', _writable: true },
  'EnablePerConnectionResults': { _value: '0', _type: 'xsd:boolean', _writable: true },
  'ROMTime': { _value: '0001-01-01T00:00:00Z', _type: 'xsd:dateTime', _writable: false },
  'BOMTime': { _value: '0001-01-01T00:00:00Z', _type: 'xsd:dateTime', _writable: false },
  'EOMTime': { _value: '0001-01-01T00:00:00Z', _type: 'xsd:dateTime', _writable: false },
  'TestBytesSent': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'TotalBytesReceived': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'TotalBytesSent': { _value: '0', _type: 'xsd:unsignedInt', _writable: false },
  'TCPOpenRequestTime': { _value: '0001-01-01T00:00:00Z', _type: 'xsd:dateTime', _writable: false },
  'TCPOpenResponseTime': { _value: '0001-01-01T00:00:00Z', _type: 'xsd:dateTime', _writable: false },
};

const cwmp_model = {
  merge,
  toInternalModel,
  portMappingDefaultParams,
  portMappingTpLinkTr098Params,
  portMappingTpLinkTr181Params,
  portMappingHuaweiParams,
  portMappingMultilaserParams,
  portMappingNokiaParams,
  commonDeviceInfoParams,
  commonManagementServerParams,
  wanConnectionDeviceParams,
  wanIPConnectionDeviceParams,
  wlanConfigurationParams,
  wlanConfigurationHuaweiParams,
  wlanConfigurationZteParams,
  ipPingDiagnosticsParams,
  traceRouteDiagnosticsParams,
  downloadDiagnosticsParams,
  uploadDiagnosticsParams
};

export default cwmp_model;
