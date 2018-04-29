
import { Mutation, Relations, fieldIsArray, getReturnGraphQLType, getReturnType, stripNonNull } from './TypeGeneratorUtils';
import { GraphQLBoolean, GraphQLField, GraphQLInputObjectType, GraphQLInputType, GraphQLList,
	 GraphQLNamedType, GraphQLNonNull, GraphQLSchema, IntrospectionField, IntrospectionObjectType, IntrospectionType, isInputType, isNonNullType, isObjectType } from 'graphql';
import { each, get, merge } from 'lodash';
import { GenerateConfig } from './GraphQLGenieInterfaces';

export class InputGenerator {

	private type: GraphQLNamedType;
	private config: GenerateConfig;
	private currInputObjectTypes: Map<string, GraphQLInputType>;
	private schemaInfo: IntrospectionType[];
	private schema: GraphQLSchema;
	private relations: Relations;

	constructor($type: GraphQLNamedType, $config: GenerateConfig, $currInputObjectTypes: Map<string, GraphQLInputType>,
		 $schemaInfo: IntrospectionType[], $schema: GraphQLSchema, $relations: Relations) {
		this.type = $type;
		this.config = $config;
		this.currInputObjectTypes = $currInputObjectTypes;
		this.schemaInfo = $schemaInfo;
		this.schema = $schema;
		this.relations = $relations;
	}

	private capFirst(val: string) {
		return val.charAt(0).toUpperCase() + val.slice(1);
	}

	private generateInputTypeForField(field: GraphQLField<any, any, {[argName: string]: any; }>,
		manyWithout: (fieldType: GraphQLNamedType, relationFieldName: string) => GraphQLInputType,
		oneWithout: (fieldType: GraphQLNamedType, relationFieldName: string) => GraphQLInputType,
		many: (fieldType: GraphQLNamedType) => GraphQLInputType,
		one: (fieldType: GraphQLNamedType) => GraphQLInputType,
	): GraphQLInputType {
		let inputType: GraphQLInputType;
		const fieldType = getReturnGraphQLType(field.type);
		const relationFieldName = this.relations.getInverseWithoutName(fieldType.name, field.name);
		const isList = fieldIsArray(field.type);
		// tslint:disable-next-line:prefer-conditional-expression
		if (relationFieldName) {
			inputType = isList ? manyWithout.call(this, fieldType, relationFieldName) : oneWithout.call(this, fieldType, relationFieldName);
		} else {
			inputType = isList ? many.call(this, fieldType) : one.call(this, fieldType);
		}
		return inputType;
	}

	private generateDummyInputTypeForFieldInfo(field: IntrospectionField, mutation: Mutation): GraphQLInputType {
		let inputType: GraphQLInputType;
		const fieldTypeName = getReturnType(field.type);
		const schemaType = this.schema.getType(fieldTypeName);
		if (isInputType(schemaType)) {
			inputType = schemaType;
		} else {
			const isArray = fieldIsArray(field.type);
			let fieldInputName = schemaType.name + Mutation[mutation];
			fieldInputName += isArray ? 'Many' : 'One';

			const relationFieldName = this.relations.getInverseWithoutName(fieldTypeName, field.name);
			fieldInputName += relationFieldName ? 'Without' + this.capFirst(relationFieldName) : '';
			fieldInputName += 'Input';
			inputType = new GraphQLInputObjectType({name: fieldInputName, fields: {}});
		}

		return inputType;
	}

	generateFieldForInput = (fieldName: string, inputType: GraphQLInputType, defaultValue?: string): object => {
		const field = {};
		field[fieldName] = {
			type: inputType,
			defaultValue: defaultValue
		};
		return field;
	}


	generateWhereUniqueInput(fieldType: GraphQLNamedType = this.type): GraphQLInputType {
		const name = fieldType.name + 'WhereUniqueInput';
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			const infoType = <IntrospectionObjectType>this.schemaInfo[fieldType.name];
			infoType.fields.forEach(field => {
				if (get(field, 'metadata.unique') === true) {
					const isArray = fieldIsArray(field.type);
					const schemaType = this.schema.getType(getReturnType(field.type));
					let inputType;
					if (isInputType(schemaType)) {
						inputType = schemaType;
					} else {
						const fieldInputName = schemaType.name + 'WhereUniqueInput';
						inputType = new GraphQLInputObjectType({name: fieldInputName, fields: {}});
					}
					if (isArray) {
						inputType = new GraphQLList(inputType);
					}
					merge(fields, this.generateFieldForInput(
						field.name,
						inputType,
						get(field, 'metadata.defaultValue')));
				}
			});

			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}

	generateCreateWithoutInput(fieldType: GraphQLNamedType, relationFieldName?: string): GraphQLInputType {

		let name = fieldType.name + 'Create';
		name += relationFieldName ? 'Without' + this.capFirst(relationFieldName) : '';
		name += 'Input';
		if (!relationFieldName) {
			return new GraphQLInputObjectType({name, fields: {}});
		}
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			const infoType = <IntrospectionObjectType>this.schemaInfo[fieldType.name];
			infoType.fields.forEach(field => {
				if (field.name !== relationFieldName && field.name !== 'id') {
					let inputType = this.generateDummyInputTypeForFieldInfo(field, Mutation.Create);
					if (field.type.kind === 'NON_NULL') {
						inputType = new GraphQLNonNull(inputType);
					}

					merge(fields, this.generateFieldForInput(
						field.name,
						inputType,
						get(field, 'metadata.defaultValue')));
				}
			});

			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}



	generateCreateManyWithoutInput(fieldType: GraphQLNamedType, relationFieldName: string): GraphQLInputType {
		const name = fieldType.name + 'CreateManyWithout' + this.capFirst(relationFieldName) + 'Input';
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			fields['create'] = {type: new GraphQLList(new GraphQLNonNull(this.generateCreateWithoutInput(fieldType, relationFieldName)))};
			fields['connect'] = {type: new GraphQLList(new GraphQLNonNull(this.generateWhereUniqueInput(fieldType)))};
			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}

	generateCreateOneWithoutInput(fieldType: GraphQLNamedType, relationFieldName: string): GraphQLInputType {
		const name = fieldType.name + 'CreateOneWithout' + this.capFirst(relationFieldName) + 'Input';
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			fields['create'] = {type: this.generateCreateWithoutInput(fieldType, relationFieldName)};
			fields['connect'] = {type: this.generateWhereUniqueInput(fieldType)};
			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}

	generateCreateManyInput(fieldType: GraphQLNamedType): GraphQLInputType {
		const name = fieldType.name + 'CreateManyInput';
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			fields['create'] = new GraphQLList(new GraphQLNonNull(this.generateCreateWithoutInput(fieldType)));
			fields['connect'] = new GraphQLList(new GraphQLNonNull(this.generateWhereUniqueInput(fieldType)));
			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}

	generateCreateOneInput(fieldType: GraphQLNamedType): GraphQLInputType {
		const name = fieldType.name + 'CreateOneInput';
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			fields['create'] = this.generateCreateWithoutInput(fieldType);
			fields['connect'] = this.generateWhereUniqueInput(fieldType);
			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}

	generateCreateInput(): GraphQLInputType {
		const name = this.type.name + 'CreateInput';
		const fields = {};
		if (isObjectType(this.type) && !this.currInputObjectTypes.has(name)) {
			each(this.type.getFields(), field => {
				if (field.name !== 'id') {
					let inputType;
					if (isInputType(field.type)) {
						inputType = field.type;
					} else {
						inputType = this.generateInputTypeForField(field, this.generateCreateManyWithoutInput,
							this.generateCreateOneWithoutInput,
							this.generateCreateManyInput,
							this.generateCreateOneInput);
						if (isNonNullType(field.type)) {
							inputType = new GraphQLNonNull(inputType);
						}
					}
					merge(fields, this.generateFieldForInput(
						field.name,
						inputType,
						get(this.schemaInfo[this.type.name].fields.find((introField) => introField.name === field.name), 'metadata.defaultValue')));
				}
			});

			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));

		}
		return this.currInputObjectTypes.get(name);
	}

	generateUpdateWithoutInput(fieldType: GraphQLNamedType, relationFieldName?: string): GraphQLInputType {

		let name = fieldType.name + 'Update';
		name += relationFieldName ? 'Without' + this.capFirst(relationFieldName) : '';
		name += 'Input';
		if (!relationFieldName) {
			return new GraphQLInputObjectType({name, fields: {}});
		}
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			const infoType = <IntrospectionObjectType>this.schemaInfo[fieldType.name];
			infoType.fields.forEach(field => {
				if (field.name !== relationFieldName && field.name !== 'id') {
					const inputType = this.generateDummyInputTypeForFieldInfo(field, Mutation.Update);
					merge(fields, this.generateFieldForInput(
						field.name,
						inputType,
						get(field, 'metadata.defaultValue')));
				}
			});

			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}

	generateUpdateWithWhereUniqueWithoutInput(fieldType: GraphQLNamedType, relationFieldName?: string): GraphQLInputType {
		const name = fieldType.name + 'UpdateWithWhereUniqueWithout' + this.capFirst(relationFieldName) + 'Input';
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			fields['data'] = {type: new GraphQLNonNull(this.generateUpdateWithoutInput(fieldType, relationFieldName))};
			fields['where'] = {type: new GraphQLNonNull(this.generateWhereUniqueInput(fieldType))};
			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}

	generateUpdateManyWithoutInput(fieldType: GraphQLNamedType, relationFieldName: string): GraphQLInputType {
		const name = fieldType.name + 'UpdateManyWithout' + this.capFirst(relationFieldName) + 'Input';
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			fields['create'] = {type: new GraphQLList(new GraphQLNonNull(this.generateCreateWithoutInput(fieldType, relationFieldName)))};
			fields['connect'] = {type: new GraphQLList(new GraphQLNonNull(this.generateWhereUniqueInput(fieldType)))};
			fields['disconnect'] = {type: new GraphQLList(new GraphQLNonNull(this.generateWhereUniqueInput(fieldType)))};
			fields['delete'] = {type: new GraphQLList(new GraphQLNonNull(this.generateWhereUniqueInput(fieldType)))};
			fields['update'] = {type: new GraphQLList(new GraphQLNonNull(this.generateUpdateWithWhereUniqueWithoutInput(fieldType, relationFieldName)))};
			if (this.config.generateUpsert) {
				fields['upsert'] = {type: new GraphQLList(new GraphQLNonNull(this.generateUpsertWithWhereUniqueWithoutInput(fieldType, relationFieldName)))};
			}
			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}

	generateUpdateOneWithoutInput(fieldType: GraphQLNamedType, relationFieldName: string): GraphQLInputType {
		const name = fieldType.name + 'UpdateOneWithout' + this.capFirst(relationFieldName) + 'Input';
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			fields['create'] = {type: this.generateCreateWithoutInput(fieldType, relationFieldName)};
			fields['connect'] = {type: this.generateWhereUniqueInput(fieldType)};
			fields['disconnect'] = {type: GraphQLBoolean};
			fields['delete'] = {type: GraphQLBoolean};
			fields['update'] = {type: this.generateUpdateWithoutInput(fieldType, relationFieldName)};
			if (this.config.generateUpsert) {
				fields['upsert'] = {type: this.generateUpsertWithoutInput(fieldType, relationFieldName)};
			}
			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}

	generateUpdateManyInput(fieldType: GraphQLNamedType): GraphQLInputType {
		const name = fieldType.name + 'UpdateManyInput';
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			fields['create'] = {type: new GraphQLList(new GraphQLNonNull(this.generateCreateWithoutInput(fieldType)))};
			fields['connect'] = {type: new GraphQLList(new GraphQLNonNull(this.generateWhereUniqueInput(fieldType)))};
			fields['disconnect'] = {type: new GraphQLList(new GraphQLNonNull(this.generateWhereUniqueInput(fieldType)))};
			fields['delete'] = {type: new GraphQLList(new GraphQLNonNull(this.generateWhereUniqueInput(fieldType)))};
			fields['update'] = {type: new GraphQLList(new GraphQLNonNull(this.generateUpdateWithWhereUniqueWithoutInput(fieldType)))};
			if (this.config.generateUpsert) {
				fields['upsert'] = {type: new GraphQLList(new GraphQLNonNull(this.generateUpsertWithWhereUniqueWithoutInput(fieldType)))};
			}
			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}

	generateUpdateOneInput(fieldType: GraphQLNamedType): GraphQLInputType {
		const name = fieldType.name + 'UpdateOneInput';
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			fields['create'] = {type: this.generateCreateWithoutInput(fieldType)};
			fields['connect'] = {type: this.generateWhereUniqueInput(fieldType)};
			fields['disconnect'] = {type: GraphQLBoolean};
			fields['delete'] = {type: GraphQLBoolean};
			fields['update'] = {type: this.generateUpdateWithoutInput(fieldType)};
			if (this.config.generateUpsert) {
				fields['upsert'] = {type: this.generateUpsertWithoutInput(fieldType)};
			}
			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}


	generateUpdateInput(): GraphQLInputType {
		const name = this.type.name + 'UpdateInput';
		const fields = {};
		if (isObjectType(this.type) && !this.currInputObjectTypes.has(name)) {
			each(this.type.getFields(), field => {
				if (field.name !== 'id') {
					let inputType;
					if (isInputType(field.type)) {
						inputType = stripNonNull(field.type);
					} else {
						inputType = this.generateInputTypeForField(field, this.generateUpdateManyWithoutInput,
							this.generateUpdateOneWithoutInput,
							this.generateUpdateManyInput,
							this.generateUpdateOneInput);
					}
					merge(fields, this.generateFieldForInput(
						field.name,
						inputType,
						get(this.schemaInfo[this.type.name].fields.find((introField) => introField.name === field.name), 'metadata.defaultValue')));
				}
			});

			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));

		}
		return this.currInputObjectTypes.get(name);
	}

	generateUpsertWithoutInput(fieldType: GraphQLNamedType, relationFieldName?: string): GraphQLInputType {

		let name = fieldType.name + 'Upsert';
		name += relationFieldName ? 'Without' + this.capFirst(relationFieldName) : '';
		name += 'Input';
		if (!relationFieldName) {
			return new GraphQLInputObjectType({name, fields: {}});
		}
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			const infoType = <IntrospectionObjectType>this.schemaInfo[fieldType.name];
			infoType.fields.forEach(field => {
				if (field.name !== relationFieldName && field.name !== 'id') {
					const inputType = this.generateDummyInputTypeForFieldInfo(field, Mutation.Upsert);
					merge(fields, this.generateFieldForInput(
						field.name,
						inputType,
						get(field, 'metadata.defaultValue')));
				}
			});

			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}

	generateUpsertWithWhereUniqueWithoutInput(fieldType: GraphQLNamedType, relationFieldName?: string): GraphQLInputType {
		const name = fieldType.name + 'UpsertWithWhereUniqueWithout' + this.capFirst(relationFieldName) + 'Input';
		if (!this.currInputObjectTypes.has(name)) {
			const fields = {};
			fields['update'] = {type: new GraphQLNonNull(this.generateUpdateWithoutInput(fieldType, relationFieldName))};
			fields['create'] = {type: new GraphQLNonNull(this.generateCreateWithoutInput(fieldType, relationFieldName))};
			fields['where'] = {type: new GraphQLNonNull(this.generateWhereUniqueInput(fieldType))};
			this.currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
		}
		return this.currInputObjectTypes.get(name);
	}
}