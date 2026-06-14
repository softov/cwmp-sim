
export type XmlNode = {
  name: string;
  namespace: string;
  localName: string;
  attrs: string;
  text: string;
  bodyIndex: number;
  children: XmlNode[]
};

export interface ISimulator {
  // send(xml: string): Promise<void>;
  // onError(err: Error): void;
}

export type CwmpNode = {
  _type: string;
  _writable: boolean;
  _value: string;
  // _children?: CwmpNode[];
  funcObj?: Function;
  funcSet?: Function;
  // [paramName: string]: CwmpNode;
};

// export type CwmpAcsOptions = {
//   url: string;
//   user?: string;
//   pass?: string;
// };

export type CwmpConnOptions = {
  ssl?: boolean;
  port?: number;
  addr?: string;
  user?: string;
  pass?: string;
  authMode?: string;
};

export type CwmpAcsOptions = {
  url: string;
  user?: string;
  pass?: string;
};

export type CwmpDeviceOptions = {
  manufacturer?: string;
  rootName?: string;
  oui?: string;
  productClass?: string;
  serialNumber?: string;
  csvPath?: string;
  jsonPath?: string;
};

export type CwmpSimulatorOptions = {
  device: CwmpDeviceOptions;
  conn: CwmpConnOptions;
  acs: CwmpAcsOptions;
};
