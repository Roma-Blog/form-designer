// ============================================================
// КОНФИГУРАЦИЯ ИСТОЧНИКОВ ДАННЫХ
// ============================================================
const TEST_DATA_URL = 'test-data.json';
const CONFIG_URL = 'form-config.json';

// Встроенные данные (fallback)
let embeddedTestData = null;
let embeddedConfig = null;

// ============================================================
// УТИЛИТЫ
// ============================================================

async function loadJSON(url, fallback) {
    if (!url) return fallback;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } catch (e) {
        console.warn('[admin.js] Не удалось загрузить ' + url + ', используем fallback.', e);
        return fallback;
    }
}

let test_data = [];

function formBuilder() {
    return {
        items: [],
        activeTab: 'constructor',
        globalConditions: [],
        loading: true,
        error: null,

        async init() {
            try {
                const testData = await loadJSON(TEST_DATA_URL, embeddedTestData || []);
                test_data = Array.isArray(testData) ? testData : [];
                console.log('[admin.js] Загружено тестовых данных:', test_data.length);

                const config = await loadJSON(CONFIG_URL, embeddedConfig);
                if (config && config.formItems) {
                    // Приводим все ID полей к строкам
                    this.items = config.formItems.map(item => ({
                        ...item,
                        id: String(item.id)
                    }));
                    
                    // Миграция условий: конвертируем старый формат в новый
                    this.globalConditions = (config.conditions || []).map(group => {
                        if (!group.conditions) return group;
                        
                        return {
                            ...group,
                            fieldId: String(group.fieldId || ''),  // Приводим к строке
                            conditions: group.conditions.map(cond => {
                                // Если есть conditionFieldId — оставляем как есть
                                if (cond.conditionFieldId) {
                                    return {
                                        id: String(cond.id),
                                        conditionFieldId: String(cond.conditionFieldId),
                                        operator: cond.operator,
                                        value: cond.value || '',
                                        valueTo: cond.valueTo || ''
                                    };
                                }
                                
                                // Старый формат с parameter — конвертируем
                                if (cond.parameter) {
                                    const field = this.items.find(
                                        f => f.type === 'field' && f.parameter === cond.parameter
                                    );
                                    
                                    return {
                                        id: String(cond.id),
                                        conditionFieldId: field ? String(field.id) : '',
                                        operator: cond.operator,
                                        value: cond.value || '',
                                        valueTo: cond.valueTo || ''
                                    };
                                }
                                
                                // Неизвестный формат — возвращаем как есть
                                return cond;
                            })
                        };
                    });
                    
                    console.log('[admin.js] Загружен существующий конфиг:', this.items.length, 'элементов');
                    console.log('[admin.js] Условия после миграции:', this.globalConditions);

                    console.log('[admin.js] Items IDs:', this.items.map(i => ({ id: i.id, type: typeof i.id })));
                    console.log('[admin.js] Conditions:', JSON.stringify(this.globalConditions, null, 2));
                    this.globalConditions.forEach((g, i) => {
                        console.log(`[admin.js] Group ${i}:`, {
                            fieldId: g.fieldId,
                            fieldIdType: typeof g.fieldId,
                            conditions: g.conditions.map(c => ({
                                conditionFieldId: c.conditionFieldId,
                                type: typeof c.conditionFieldId
                            }))
                        });
                    });
                }
            } catch (e) {
                this.error = 'Ошибка загрузки данных: ' + e.message;
                console.error(e);
            } finally {
                this.loading = false;
            }
        },

        // Метод для ручной перезагрузки данных
        async reloadData() {
            this.loading = true;
            await this.init();
            alert('Данные перезагружены');
        },

        // Метод для загрузки файла через input
        async loadTestDataFromFile(event) {
            const file = event.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (Array.isArray(data)) {
                    test_data = data;
                    console.log('[admin.js] Загружено из файла:', data.length, 'записей');
                    alert('Тестовые данные загружены: ' + data.length + ' записей');
                } else {
                    alert('Ошибка: файл должен содержать массив');
                }
            } catch (e) {
                alert('Ошибка чтения файла: ' + e.message);
            }
        },

        async loadConfigFromFile(event) {
            const file = event.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const config = JSON.parse(text);
                if (config.formItems) {
                    this.items = config.formItems;
                    this.globalConditions = config.conditions || [];
                    console.log('[admin.js] Конфиг загружен из файла');
                    alert('Конфигурация загружена');
                } else {
                    alert('Ошибка: неверный формат конфига');
                }
            } catch (e) {
                alert('Ошибка чтения файла: ' + e.message);
            }
        },

        showValueLabel(typeForm) {
            return typeForm === 'array_of_values_with_arbitrary_input';
        },
        
        showValueUnit(typeForm) {
            return typeForm === 'yes_no_range' || 
                   typeForm === 'array_of_values_with_arbitrary_input';
        },

        showRadioOptions(typeForm) {
            return typeForm === 'selecting_radio_button_values';
        },

        getUniqueValues(parameter) {
            const values = new Set();
            test_data.forEach(item => {
                if (item.hasOwnProperty(parameter)) {
                    const val = item[parameter];
                    
                    // Обработка null/undefined
                    if (val === null || val === undefined) {
                        values.add('null');
                        return;
                    }
                    
                    // Если строка с запятыми — разбиваем
                    if (typeof val === 'string' && val.includes(',')) {
                        val.split(',')
                            .map(s => s.trim())
                            .filter(s => s !== '')
                            .forEach(v => values.add(v));
                        return;
                    }
                    
                    values.add(String(val));
                }
            });
            return Array.from(values).sort((a, b) => {
                if (a === 'null') return -1;
                if (b === 'null') return 1;
                const numA = Number(a);
                const numB = Number(b);
                if (!isNaN(numA) && !isNaN(numB) && a !== '' && b !== '') {
                    return numA - numB;
                }
                return a.localeCompare(b, 'ru');
            });
        },

        updateRadioOptions(item) {
            if (item.type_form === 'selecting_radio_button_values') {
                const uniqueValues = this.getUniqueValues(item.parameter);
                item.radioOptions = uniqueValues.map(val => ({
                    value: val,
                    label: val
                }));
            } else {
                item.radioOptions = [];
            }
        },
        
        addField() {
            this.items.push({
                id: Math.floor(Date.now() + Math.random()),
                title: '',
                type: 'field',
                parameter: 'd',
                type_form: 'array_of_values',
                customValueLabel: '',
                customValueUnit: '',
                displayColumns: 'two',  
                options: '',
                radioOptions: [],
                customMinParam: '',
                customMaxParam: '',
                customUnit: ''
            });
            this.scrollToBottom();
        },
        
        addTitle() {
            this.items.push({
                id: Math.floor(Date.now() + Math.random()),
                type: 'title',
                title: 'Новый заголовок'
            });
            this.scrollToBottom();
        },
        
        removeItem(index) {
            if (confirm('Удалить этот элемент?')) {
                this.items.splice(index, 1);
            }
        },
        
        moveUp(index) {
            if (index > 0) {
                [this.items[index - 1], this.items[index]] = 
                [this.items[index], this.items[index - 1]];
            }
        },
        
        moveDown(index) {
            if (index < this.items.length - 1) {
                [this.items[index + 1], this.items[index]] = 
                [this.items[index], this.items[index + 1]];
            }
        },
        
        getFieldIndex(fieldId) {
            const fieldsOnly = this.items.filter(item => item.type === 'field');
            return fieldsOnly.findIndex(item => String(item.id) === String(fieldId));
        },

        getFields() {
            return this.items.filter(item => item.type === 'field');
        },

        getParameterLabel(parameter) {
            const labels = {
                'd': 'Диаметр',
                'hod_array': 'Рабочий ход',
                'stock': 'Исполнение штока',
                'stock_material': 'Материал штока',
                'cylinder_type': 'Тип цилиндра',
                'braking': 'Торможение',
                'groove': 'Паз',
                'back_cover': 'Задняя крышка'
            };
            return labels[parameter] || parameter;
        },

        addGlobalCondition() {
            this.globalConditions.push({
                id: Math.floor(Date.now() + Math.random()),
                fieldId: '',
                action: 'show',
                logic: 'AND',
                conditions: [{
                    id: Math.floor(Date.now() + Math.random()),
                    conditionFieldId: '',  // было: parameter: 'd'
                    operator: 'equals',
                    value: '',
                    valueTo: ''
                }]
            });
        },
        
        removeGlobalCondition(index) {
            if (confirm('Удалить эту группу условий?')) {
                this.globalConditions.splice(index, 1);
            }
        },

        addConditionToGroup(groupIndex) {
            this.globalConditions[groupIndex].conditions.push({
                id: Math.floor(Date.now() + Math.random()),
                conditionFieldId: '',  // было: parameter: 'd'
                operator: 'equals',
                value: '',
                valueTo: ''
            });
        },

        removeConditionFromGroup(groupIndex, condIndex) {
            this.globalConditions[groupIndex].conditions.splice(condIndex, 1);
        },
        
        scrollToBottom() {
            setTimeout(() => {
                const container = document.getElementById('fields-container');
                const lastElement = container?.lastElementChild;
                if (lastElement) {
                    lastElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        },
        
        saveForm() {
            const formData = {
                items: this.items.map(item => {
                    if (item.type === 'field') {
                        return {
                            ...item,
                            optionsArray: item.type_form === 'array_of_values' && item.options 
                                ? item.options.split('\n').filter(opt => opt.trim())
                                : []
                        };
                    }
                    return item;
                })
            };
            
            console.log('Saved schema:', formData);
            alert('Form saved. Check console (F12)');
        },

        saveFullConfig() {
            const fullConfig = {
                formItems: this.items.map(item => {
                    if (item.type === 'field') {
                        return {
                            ...item,
                            optionsArray: item.type_form === 'array_of_values' && item.options 
                                ? item.options.split('\n').filter(opt => opt.trim())
                                : []
                        };
                    }
                    return item;
                }),
                conditions: this.globalConditions,
                version: '1.0',
                exportedAt: new Date().toISOString()
            };
            
            console.log('FULL CONFIGURATION SAVED:', fullConfig);
            
            const dataStr = JSON.stringify(fullConfig, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
            const exportFileDefaultName = `form-config-${Date.now()}.json`;
            
            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', dataUri);
            linkElement.setAttribute('download', exportFileDefaultName);
            linkElement.click();
            
            alert('Конфигурация сохранена! JSON файл скачан.');
        },
        getNumericParameters() {
            const numericParams = [];
            
            if (test_data.length === 0) return numericParams;
            
            // Проверяем все ключи первого объекта
            const firstItem = test_data[0];
            Object.keys(firstItem).forEach(key => {
                const value = firstItem[key];
                // Проверяем, что значение числовое (не null, не строка, не массив)
                if (value !== null && typeof value === 'number' && !isNaN(value)) {
                    numericParams.push({
                        key: key,
                        label: this.getParameterLabel(key) || key
                    });
                }
            });
            
            return numericParams;
        }
    }
}