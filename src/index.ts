import {JSONSchema4, JSONSchema4TypeName} from 'json-schema';

type FilteredItem = { path: string, reason: string };

class ValidationError extends Error {
  constructor(message: string, path: string) {
    super(`Invalid data for schema: ${message} at path ${path}`);
  }
}

function getDataType(data: any): string {
  if (Array.isArray(data)) return 'array';

  if (data === null) return 'null';

  return typeof data;
  //
  // const type = typeof data;
  //
  // switch (type) {
  //   case 'number':
  //   case 'object':
  //   case 'string':
  //   case 'boolean':
  //     return type;
  //
  //   default:
  //     return undefined;
  // }
}
function toArray<T>(x: T | T[] | undefined): T[] | undefined {
  if (x === undefined) {
    return undefined;
  }
  return Array.isArray(x) ? x : [x];
}

export function filter(
    schema: JSONSchema4,
    options: {
      cropArrays?: boolean;
      removeAdditionalItems?: boolean;
      removeAdditionalProperties?: boolean;
      ignoreRequiredProperties?: boolean;
      convertPrimitives?: boolean;
    } = {},
): (data: any) => { result: any, filtered: FilteredItem[] } {
  const filtered: FilteredItem[] = [];

  function inner(data: any, schema: JSONSchema4, path: string): any {
    // const dataTypes = getCompatibleSchemaTypes(data);
    const types = toArray(schema.type);

    if (!types) {
      return data;
    }

    // TODO turn this around to one loop of types
    const dataType = getDataType(data);

    for (const type of types) {
      switch (type) {
        case 'null':
          if (dataType === 'null') {
            return data;
          }
          break;

        case 'array':
          if (dataType === 'array') {
            const {items = true, additionalItems = true, minItems = 0, maxItems = Number.MAX_SAFE_INTEGER} = schema;

            if (data.length < minItems) {
              throw new ValidationError(`Array shorter than ${minItems}`, path);
            }

            return (data as any[]).reduce((result, v, i) => {
              const subPath = `${path}[${i}]`;
              const s = Array.isArray(items) ?
                  i < items.length ? items[i] : additionalItems :
                  items;

              if (s === false) {
                if (!options.removeAdditionalItems) {
                  throw new ValidationError(`Array item outside of schema items and additionalItems is false`, subPath);
                }
                filtered.push({
                  path: subPath,
                  reason: `Array item outside of schema items and additionalItems is false`,
                });
              } else if (i >= maxItems) {
                if (!options.cropArrays) {
                  throw new ValidationError(`Array longer than ${maxItems}`, path);
                }

                filtered.push({
                  path: subPath,
                  reason: `Array item index ${i} outside of schema maxItems ${maxItems}`,
                });
              } else if (s === true) {
                result.push(v);
              } else {
                result.push(inner(v, s, subPath));
              }
              return result;
            }, [] as any[]);
          }
          break;

        case 'object':
          if (dataType === 'object') {
            const {properties, additionalProperties = true, required = []} = schema;

            if (!options.ignoreRequiredProperties && required) {
              for (const k of required) {
                if (data[k] === undefined) {
                  throw new ValidationError(`Required object property ${k} missing`, `${path}.${k}`);
                }
              }
            }

            return Object.entries(data)
                .reduce((result, [k, v]) => {
                  if (v !== undefined) {
                    const subPath = `${path}.${k}`;
                    const s = properties?.[k] ?? additionalProperties;

                    if (s === false) {
                      if (!options.removeAdditionalProperties) {
                        throw new ValidationError(`Object property not in schema properties and additionalProperties is false`, subPath);
                      }
                      filtered.push({
                        path: subPath,
                        reason: `Object property not in schema properties and additionalProperties is false`,
                      });
                    } else if (s === true) {
                      result[k] = v;
                    } else {
                      result[k] = inner(v, s, subPath);
                    }
                  }
                  return result;
                }, {} as any);
          }
          break;

          // TODO extract conversions and align enum checks across all primitives
        case 'number':
        case 'integer':
          if (dataType === 'number' || options.convertPrimitives && ['boolean', 'string'].includes(dataType)) {
            const n = Number(data);

            if (!isNaN(n) && (type === 'number' || Number.isInteger(n))) {
              return n;
            }
          }
          break;

        case 'boolean':
          if (dataType === 'boolean') {
            return data;
          }

          if (options.convertPrimitives && dataType === 'number') {
            switch (data) {
              case 0:
                return false;
              case 1:
                return true;
              default:
                break;
            }
          }

          if (options.convertPrimitives && dataType === 'string') {
            switch (data.toLowerCase()) {
              case 'false':
                return false;
              case 'true':
                return true;
              default:
                break;
            }
          }
          break;

        case 'string':
          if (dataType === 'string') {
            return data;
          }

          if (options.convertPrimitives) {
            return data.toString();
          }
          break;
      }
    }

    throw new ValidationError(`Expected ${types} but found ${dataType}`, path);

    // if (data === null) {
    //   for (const type of types) {
    //     if (type === 'null') {
    //       return data;
    //     }
    //   }
    //   throw new ValidationError(`Expected ${types} but found null`, path);
    // }
    //
    // if (Array.isArray(data)) {
    //   for (const type of types) {
    //     if (type === 'array') {
    //       const {items = true, additionalItems = true, minItems = 0, maxItems = Number.MAX_SAFE_INTEGER} = schema;
    //
    //       if (data.length < minItems) {
    //         throw new ValidationError(`Array shorter than ${minItems}`, path);
    //       }
    //
    //       return (data as any[]).reduce((result, v, i) => {
    //         const subPath = `${path}[${i}]`;
    //         const s = Array.isArray(items) ?
    //             i < items.length ? items[i] : additionalItems :
    //             items;
    //
    //         if (s === false) {
    //           if (!options.removeAdditionalItems) {
    //             throw new ValidationError(`Array item outside of schema items and additionalItems is false`, subPath);
    //           }
    //           filtered.push({
    //             path: subPath,
    //             reason: `Array item outside of schema items and additionalItems is false`,
    //           });
    //         } else if (i >= maxItems) {
    //           if (!options.cropArrays) {
    //             throw new ValidationError(`Array longer than ${maxItems}`, path);
    //           }
    //
    //           filtered.push({
    //             path: subPath,
    //             reason: `Array item index ${i} outside of schema maxItems ${maxItems}`,
    //           });
    //         } else if (s === true) {
    //           result.push(v);
    //         } else {
    //           result.push(inner(v, s, subPath));
    //         }
    //         return result;
    //       }, [] as any[]);
    //     }
    //   }
    //
    //   throw new ValidationError(`Expected ${types} but found array`, path);
    // }
    //
    // if (typeof data === 'object') {
    //   for (const type of types) {
    //     if (type === 'object') {
    //       const {properties, additionalProperties = true, required = []} = schema;
    //
    //       if (!options.ignoreRequiredProperties && required) {
    //         for (const k of required) {
    //           if (data[k] === undefined) {
    //             throw new ValidationError(`Required object property ${k} missing`, `${path}.${k}`);
    //           }
    //         }
    //       }
    //
    //       return Object.entries(data)
    //           .reduce((result, [k, v]) => {
    //             if (v !== undefined) {
    //               const subPath = `${path}.${k}`;
    //               const s = properties?.[k] ?? additionalProperties;
    //
    //               if (s === false) {
    //                 if (!options.removeAdditionalProperties) {
    //                   throw new ValidationError(`Object property not in schema properties and additionalProperties is false`, subPath);
    //                 }
    //                 filtered.push({
    //                   path: subPath,
    //                   reason: `Object property not in schema properties and additionalProperties is false`,
    //                 });
    //               } else if (s === true) {
    //                 result[k] = v;
    //               } else {
    //                 result[k] = inner(v, s, subPath);
    //               }
    //             }
    //             return result;
    //           }, {} as any);
    //     }
    //   }
    //   throw new ValidationError(`Expected ${types} but found object`, path);
    // }
    //
    // if (typeof data === 'number') {
    //   for (const type of types) {
    //     if (type === 'number') {
    //       return data;
    //     }
    //
    //     if (type === 'integer' && Number.isInteger(data)) {
    //       return data;
    //     }
    //
    //     if (options.convertPrimitives && type === 'boolean' && [0, 1].includes(data)) {
    //       return data === 1;
    //     }
    //
    //     if (options.convertPrimitives && type === 'string') {
    //       return data.toString();
    //     }
    //   }
    //   throw new ValidationError(`Expected ${types} but found number`, path);
    // }
    //
    // if (typeof data === 'boolean') {
    //   for (const type of types) {
    //     if (type === 'boolean') {
    //       return data;
    //     }
    //
    //     if (options.convertPrimitives && ['number', 'integer'].includes(type)) {
    //       return data ? 1 : 0;
    //     }
    //
    //     if (options.convertPrimitives && type === 'string') {
    //       return data.toString();
    //     }
    //   }
    //   throw new ValidationError(`Expected ${types} but found boolean`, path);
    // }
    //
    // if (typeof data === 'string') {
    //   for (const type of types) {
    //     if (type === 'string') {
    //       return data;
    //     }
    //
    //     const n = Number(data);
    //
    //     if (options.convertPrimitives && type === 'integer' && Number.isInteger(n)) {
    //       return n;
    //     }
    //
    //     if (options.convertPrimitives && type === 'number' && !isNaN(n)) {
    //       return n;
    //     }
    //
    //     const b = data.toLowerCase();
    //
    //     if (options.convertPrimitives && type === 'boolean' && ['true', 'false'].includes(b))
    //       return b === 'true';
    //   }
    //   throw new ValidationError(`Expected ${types} but found string`, path);
    // }
  }

  return data => {
    const result = inner(data, schema, '$');

    return {result, filtered};
  };
}

const f = filter({
  type: 'object',
  additionalProperties: false,
  required: ['foo', 'bar'],
  properties: {
    foo: {type: 'string', enum: ['FOO', 'BAR']},
    bar: {type: 'number'},
    baz: {type: 'integer'},
    qux: {type: 'array', items: {type: 'object', properties: {foo: {type: 'string'}}}},
  },
}, {removeAdditionalProperties: true, convertPrimitives: true});

console.log(f({foo: 'hello', bar: 42, baz: '43', hlall:'woräd'}));