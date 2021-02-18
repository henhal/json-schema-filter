import {JSONSchema4, JSONSchema4Type, JSONSchema4TypeName} from 'json-schema';

type FilteredItem = { path: string, reason: string };

class ValidationError extends Error {
  constructor(message: string, path: string) {
    super(`Invalid data for schema: ${message} at path ${path}`);
  }
}

function getDataType(data: any): string {
  if (Array.isArray(data)) return 'array';

  if (data === null) return 'null';

  if (Number.isInteger(data)) return 'integer';

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

// type Visitor<Context> = (data: any, schema: JSONSchema4 | boolean, context: Context) => any
//
// function traverse<Context>(
//     schema: JSONSchema4,
//     visitor: Visitor<Context>
// ): (data: any, context: Context) => { result: any, context: Context } {
//   return null as any;
// }

function parseSchema(schemaLike: JSONSchema4 | boolean): JSONSchema4 | null {
  return schemaLike === true ? {} : schemaLike === false ? null : schemaLike;
}

function getItemSchema(schema: JSONSchema4, index: number) {
  const {items = true, additionalItems = true} = schema;

  return parseSchema(Array.isArray(items) ?
      index < items.length ? items[index] : additionalItems :
      items);
}

function getPropertySchema(schema: JSONSchema4, key: string) {
  const {properties, additionalProperties = true} = schema;

  return parseSchema(properties?.[key] ?? additionalProperties);
}

type TypeOf<T extends string> = T extends 'string' ? string :
    T extends 'number' ? number :
        T extends 'boolean' ? boolean :
            never;

function isTypeCompatible(t1: string, t2: string) {
  return t1 === t2 || t1 === 'integer' && t2 === 'number';
}

class SchemaTransformer {
  protected coerce<T extends string>(data: any, type: T): TypeOf<T> | null {
    const dataType = getDataType(data);

    return isTypeCompatible(dataType, type) ? data : null;
  }

  protected visit(data: any, schema: JSONSchema4, path: string): any {
    // TODO handle oneOf etc

    const types = toArray(schema.type);
    let value = data;

    if (schema.enum) {
      if (!schema.enum.some(x => {
        const dataType = getDataType(x) as JSONSchema4TypeName;

        if (types && !types.some(type => isTypeCompatible(dataType, type))) return false;

        value = this.coerce(data, dataType);

        return value === x;
      })) {
        throw new ValidationError(`Value must match one of the enum values`, path);
      }
    } else if (types) {
      if (!types.some(type => {
        value = this.coerce(data, type);

        return value !== undefined;
      })) {
        throw new ValidationError(`Value must match one of the schema types`, path);
      }
    }

    const type = getDataType(value);

    if (type === 'string') {
      if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
        throw new ValidationError(`Value must match the regular expression`, path);
      }

      if (schema.minLength && !(data.length >= schema.minLength)) {
        throw new ValidationError(`Value must be at least the minimum length`, path);
      }

      if (schema.maxLength && !(data.length <= schema.maxLength)) {
        throw new ValidationError(`Value must be at most the maximum length`, path);
      }

      // TODO format

    }

    if (type === 'number' || type === 'integer') {
      if (schema.maximum !== undefined && !(data <= schema.maximum)) {
        throw new ValidationError(`Value must not be greater than the maximum value`, path);
      }

      if (schema.exclusiveMaximum !== undefined && !(data < schema.exclusiveMaximum)) {
        throw new ValidationError(`Value must not be greater than the exclusive maximum value`, path);
      }

      if (schema.minimum !== undefined && !(data <= schema.minimum)) {
        throw new ValidationError(`Value must not be less than the minimum value`, path);
      }

      if (schema.exclusiveMinimum !== undefined && !(data > schema.exclusiveMinimum)) {
        throw new ValidationError(`Value must not be greater than the exclusive minimum value`, path);
      }

      if (schema.multipleOf !== undefined && !((data % schema.multipleOf) === 0)) {
        throw new ValidationError(`Value must be multiple of the given value`, path);
      }
    }

    if (type === 'array') {
      const array = data as any[];

      if (schema.maxItems !== undefined && !(array.length <= schema.maxItems)) {
        throw new ValidationError(`Array items must not be more than maxItems`, path);
      }

      if (schema.minItems !== undefined && !(array.length >= schema.minItems)) {
        throw new ValidationError(`Array items must not be fewer than minItems`, path);
      }

      if (schema.uniqueItems && !(array.every((e, i) => array.every((e2, i2) => i === i2 || e2 !== e)))) {
        throw new ValidationError(`Array items must be unique`, path);
      }
    }

    if (type === 'object') {
      if (schema.maxProperties !== undefined && !(data.length <= schema.maxProperties)) {
        throw new ValidationError(`Object properties must not be more than maxProperties`, path);
      }

      if (schema.minProperties !== undefined && !(data.length >= schema.minProperties)) {
        throw new ValidationError(`Object properties must not be fewer than minProperties`, path);
      }

      if (Array.isArray(schema.required)) {
        for (const k of schema.required) {
          if (data[k] === undefined) {
            throw new ValidationError(`Required object property ${k} missing`, path);
          }
        }
      }
    }
  }

  public transform(input: any, schema: JSONSchema4, path = '$'): any {
    const output = this.visit(input, schema, path);
    const outputType = getDataType(output);

    switch (outputType) {
      case 'array': {
        return (output as any[]).map((item, i) => {
          const itemPath = `${path}[${i}]`;
          const itemSchema = getItemSchema(schema, i);

          if (!itemSchema) {
            throw new ValidationError(`Array item outside of schema items and additionalItems is false`, itemPath);
          }

          return this.transform(item, itemSchema, itemPath);
        });
      }

      case 'object': {
        return Object.fromEntries(Object.entries(output)
            .map(([key, val]) => {
              const propertyPath = `${path}.${key}`;
              const propertySchema = getPropertySchema(schema, key);

              if (!propertySchema) {
                throw new ValidationError(`Object property not in schema properties and additionalProperties is false`, propertyPath);
              }
              return [key, this.transform(val, propertySchema, propertyPath)];
            }));
      }

      default: {
        return output;
      }
    }
  }
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
              throw new ValidationError(`
Array shorter than $
{
  minItems
}
`, path);
            }

            return (data as any[]).reduce((result, v, i) => {
              const subPath = `
$
{
  path
}
[$
{
  i
}
]
`;
              const itemSchema = Array.isArray(items) ?
                  i < items.length ? items[i] : additionalItems :
                  items;

              if (itemSchema === false) {
                if (!options.removeAdditionalItems) {
                  throw new ValidationError(`
Array item outside of schema items and additionalItems is false
`, subPath);
                }
                filtered.push({
                  path: subPath,
                  reason: `
Array item outside of schema items and additionalItems is false
`,
                });
              } else if (i >= maxItems) {
                if (!options.cropArrays) {
                  throw new ValidationError(`
Array longer than $
{
  maxItems
}
`, path);
                }

                filtered.push({
                  path: subPath,
                  reason: `
Array item index $
{
  i
}
 outside of schema maxItems $
{
  maxItems
}
`,
                });
              } else if (itemSchema === true) {
                result.push(v);
              } else {
                result.push(inner(v, itemSchema, subPath));
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
                  throw new ValidationError(`
Required object property $
{
  k
}
 missing
`, `
$
{
  path
}
.$
{
  k
}
`);
                }
              }
            }

            return Object.entries(data)
                .reduce((result, [k, v]) => {
                  if (v !== undefined) {
                    const subPath = `
$
{
  path
}
.$
{
  k
}
`;
                    const propertySchema = properties?.[k] ?? additionalProperties;

                    if (propertySchema === false) {
                      if (!options.removeAdditionalProperties) {
                        throw new ValidationError(`
Object property not in schema properties and additionalProperties is false
`, subPath);
                      }
                      filtered.push({
                        path: subPath,
                        reason: `
Object property not in schema properties and additionalProperties is false
`,
                      });
                    } else if (propertySchema === true) {
                      result[k] = v;
                    } else {
                      result[k] = inner(v, propertySchema, subPath);
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

    throw new ValidationError(`
Expected $
{
  types
}
 but found $
{
  dataType
}
`, path);

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

console.log(f({foo: 'hello', bar: 42, baz: '43', hlall: 'woräd'}));