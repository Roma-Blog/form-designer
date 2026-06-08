// ============================================================
// КОНФИГУРАЦИЯ ИСТОЧНИКОВ ДАННЫХ
// ============================================================
// Укажите пути к JSON-файлам. Если файл не загрузится —
// будут использованы встроенные данные (embeddedConfig / embeddedTestData).

const CONFIG_URL = 'form-config.json';
const TEST_DATA_URL = 'test-data.json';

// Встроенный конфиг (fallback). Оставьте null, если загружаете из файла.
let embeddedConfig = null;
/*
// Пример встроенного конфига:
embeddedConfig = {
    formItems: [ ... ],
    conditions: [ ... ],
    version: '1.0'
};
*/

// Встроенные тестовые данные (fallback). Оставьте null, если загружаете из файла.
let embeddedTestData = null;
/*
// Пример:
embeddedTestData = [
    { id: 89, base: 'KVSC-32-PPV', d: 32, stock: null, ... },
    ...
];
*/

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
        console.warn('[site.js] Не удалось загрузить ' + url + ', используем fallback.', e);
        return fallback;
    }
}

const PARAMETER_LABELS = {
    'd': 'Диаметр (d)',
    'hod_array': 'Рабочий ход',
    'stock': 'Исполнение штока',
    'groove': 'Тип канавки',
    'stock_material': 'Материал штока',
    'cylinder_type': 'Тип цилиндра',
    'braking': 'Торможение',
    'back_cover': 'Задняя крышка'
};

// ============================================================
// ALPINE-КОМПОНЕНТ
// ============================================================

function siteApp() {
    return {
        config: null,
        testData: [],
        formData: {},   // { [itemId]: значение }
        loading: true,
        error: null,

        async init() {
            try {
                const [config, testData] = await Promise.all([
                    loadJSON(CONFIG_URL, embeddedConfig),
                    loadJSON(TEST_DATA_URL, embeddedTestData || [])
                ]);

                if (!config || !config.formItems) {
                    this.error = 'Конфигурация формы не найдена или повреждена.';
                    this.loading = false;
                    return;
                }

                this.config = config;
                this.testData = Array.isArray(testData) ? testData : [];
                this.initFormData();
            } catch (e) {
                this.error = 'Ошибка инициализации: ' + e.message;
                console.error(e);
            } finally {
                this.loading = false;
            }
        },

        initFormData() {
            this.config.formItems.forEach(item => {
                if (item.type !== 'field') return;
                switch (item.type_form) {
                    case 'selecting_radio_button_values': {
                        // Автовыбор первого значения — сохраняем
                        const options = this.getFieldOptions(item);
                        this.formData[item.id] = options.length > 0 ? options[0].value : '';
                        break;
                    }
                    case 'array_of_values':
                        // Без автовыбора — поле пустое при загрузке
                        this.formData[item.id] = '';
                        break;
                    case 'array_of_values_with_arbitrary_input': {
                        // Без автовыбора — режим "array", но ничего не выбрано
                        this.formData[item.id] = { 
                            mode: 'array',
                            selected: '',
                            custom: '' 
                        };
                        break;
                    }
                    case 'yes_no_range':
                        this.formData[item.id] = { mode: 'no', value: '' };
                        break;
                    default:
                        // Произвольное поле (custom) и другие неизвестные типы
                        if (item.parameter === 'custom') {
                            this.formData[item.id] = { mode: 'no', value: '' };
                        } else {
                            this.formData[item.id] = '';
                        }
                        break;
                }
            });
        },

        // Получение глобальных min/max для произвольного поля из базы данных
        getCustomRange(item) {
            if (item.parameter !== 'custom' || !item.customMinParam || !item.customMaxParam) {
                return { hasLimits: false, min: null, max: null };
            }

            let globalMin = Infinity;
            let globalMax = -Infinity;
            let found = false;

            this.testData.forEach(row => {
                if (!row) return;
                
                // Ищем min по customMinParam
                if (row.hasOwnProperty(item.customMinParam)) {
                    const val = Number(row[item.customMinParam]);
                    if (!isNaN(val)) {
                        if (val < globalMin) globalMin = val;
                        found = true;
                    }
                }
                
                // Ищем max по customMaxParam
                if (row.hasOwnProperty(item.customMaxParam)) {
                    const val = Number(row[item.customMaxParam]);
                    if (!isNaN(val)) {
                        if (val > globalMax) globalMax = val;
                        found = true;
                    }
                }
            });

            if (!found || globalMin === Infinity || globalMax === -Infinity) {
                return { hasLimits: false, min: null, max: null };
            }

            return { hasLimits: true, min: globalMin, max: globalMax };
        },

        // Автокоррекция значения произвольного поля до границ из базы
        correctCustomFieldValue(item) {
            const data = this.formData[item.id];
            if (!data || data.mode === 'no' || data.value === '' || data.value === null || data.value === undefined) {
                return;
            }

            const range = this.getCustomRange(item);
            if (!range.hasLimits) return;

            const valNum = Number(data.value);
            if (isNaN(valNum)) {
                data.value = range.min;
                return;
            }

            if (valNum < range.min) {
                data.value = range.min;
            } else if (valNum > range.max) {
                data.value = range.max;
            }
        },

        // Получение минимального и максимального значений для диапазона
        getRangeLimits(item) {
            const options = this.getFieldOptions(item);
            const numericValues = options
                .map(opt => Number(opt.value))
                .filter(num => !isNaN(num));

            if (numericValues.length > 0) {
                return {
                    hasLimits: true,
                    min: Math.min(...numericValues),
                    max: Math.max(...numericValues)
                };
            }
            return { hasLimits: false, min: null, max: null };
        },

        // Автокоррекция значения диапазона до ближайшего валидного
        correctRangeValue(item) {
            const data = this.formData[item.id];
            // Корректируем только если режим "yes" и поле не пустое
            if (!data || data.mode === 'no' || data.value === '' || data.value === null || data.value === undefined) {
                return;
            }

            const limits = this.getRangeLimits(item);
            if (!limits.hasLimits) return;

            const valNum = Number(data.value);
            if (isNaN(valNum)) {
                // Если введено не число, сбрасываем на минимум
                data.value = limits.min;
                return;
            }

            // Корректируем до ближайшей границы
            if (valNum < limits.min) {
                data.value = limits.min;
            } else if (valNum > limits.max) {
                data.value = limits.max;
            }
        },

        // Человекочитаемый лейбл параметра
        getParameterLabel(parameter) {
            return PARAMETER_LABELS[parameter] || parameter;
        },

        // Уникальные значения параметра из testData (сортированные)
        getUniqueValuesFromData(parameter) {
            const values = new Set();
            this.testData.forEach(row => {
                if (row && row.hasOwnProperty(parameter)) {
                    const val = row[parameter];
                    
                    // Если значение null/undefined
                    if (val === null || val === undefined) {
                        values.add('null');
                        return;
                    }
                    
                    // Если это строка с запятыми — разбиваем на массив
                    if (typeof val === 'string' && val.includes(',')) {
                        val.split(',')
                            .map(s => s.trim())
                            .filter(s => s !== '')
                            .forEach(v => values.add(v));
                        return;
                    }
                    
                    // Обычное значение
                    values.add(String(val));
                }
            });
            
            return Array.from(values).sort((a, b) => {
                if (a === 'null') return -1;
                if (b === 'null') return 1;
                const numA = Number(a), numB = Number(b);
                if (!isNaN(numA) && !isNaN(numB) && a !== '' && b !== '') return numA - numB;
                return a.localeCompare(b, 'ru');
            });
        },

        // Опции для рендера поля
        getFieldOptions(item) {
            // Для произвольного поля генерируем диапазон из test_data
            if (item.parameter === 'custom' && item.customMinParam && item.customMaxParam) {
                // Получаем min и max из первой записи test_data
                const firstItem = this.testData[0];
                if (firstItem) {
                    const min = firstItem[item.customMinParam];
                    const max = firstItem[item.customMaxParam];
                    
                    if (typeof min === 'number' && typeof max === 'number' && !isNaN(min) && !isNaN(max) && min < max) {
                        // Генерируем массив значений с шагом
                        const step = this.calculateStep(min, max);
                        const options = [];
                        for (let i = min; i <= max; i += step) {
                            const val = Math.round(i * 100) / 100;
                            options.push({ value: String(val), label: String(val) });
                        }
                        // Убедимся, что max включён
                        if (options.length === 0 || Number(options[options.length - 1].value) !== max) {
                            options.push({ value: String(max), label: String(max) });
                        }
                        return options;
                    }
                }
            }
            
            // Остальная логика без изменений
            if (item.type_form === 'selecting_radio_button_values') {
                if (item.radioOptions && item.radioOptions.length > 0) {
                    return item.radioOptions;
                }
                return this.getUniqueValuesFromData(item.parameter)
                    .map(v => ({ value: v, label: v }));
            }
            if (item.optionsArray && item.optionsArray.length > 0) {
                return item.optionsArray.map(v => ({ value: String(v), label: String(v) }));
            }
            return this.getUniqueValuesFromData(item.parameter)
                .map(v => ({ value: v, label: v }));
        },

        // Вспомогательная функция для расчёта шага
        calculateStep(min, max) {
            const range = max - min;
            if (range <= 10) return 1;
            if (range <= 100) return 5;
            if (range <= 1000) return 10;
            if (range <= 10000) return 100;
            return 1000;
        },

        // Получить текущее выбранное значение по параметру (для условий)
        getParameterValueByParameter(parameter) {
            if (!this.config || !this.config.formItems) return null;
            const field = this.config.formItems.find(
                i => i.type === 'field' && i.parameter === parameter
            );
            if (!field) return null;
            return this.formData[field.id];
        },

        // Получить значение конкретного поля формы по его id
        getFieldValueById(fieldId) {
            if (!this.formData.hasOwnProperty(fieldId)) return null;
            return this.formData[fieldId];
        },

        // Нормализация значения к массиву строк для проверки условия
        normalizeToValuesArray(value) {
            if (value === null || value === undefined || value === '') return [];
            if (Array.isArray(value)) return value.map(String);
            if (typeof value === 'object') {
                // array_of_values_with_arbitrary_input
                if ('mode' in value && 'selected' in value && 'custom' in value) {
                    if (value.mode === 'custom' && value.custom !== '' && value.custom !== null && value.custom !== undefined) {
                        return [String(value.custom)];
                    }
                    if (value.mode === 'array' && value.selected !== '' && value.selected !== null && value.selected !== undefined) {
                        return [String(value.selected)];
                    }
                    return [];
                }
                // yes_no_range и custom (одинаковый формат: {mode, value})
                if ('mode' in value && 'value' in value) {
                    if (value.mode === 'yes' && value.value !== '' && value.value !== null && value.value !== undefined) {
                        return [String(value.value)];
                    }
                    return [];
                }
                // yes_no_range старый формат (from/to)
                if ('from' in value || 'to' in value) {
                    const arr = [];
                    if (value.from !== '' && value.from !== null) arr.push(String(value.from));
                    if (value.to !== '' && value.to !== null) arr.push(String(value.to));
                    return arr;
                }
                return [];
            }
            return [String(value)];
        },

        // Проверка одного условия
        evaluateCondition(condition) {
            // Получаем значение по ID поля формы (а не по параметру)
            const raw = this.getFieldValueById(condition.conditionFieldId);
            const values = this.normalizeToValuesArray(raw);
            const operator = condition.operator;

            // Операторы проверки наличия значения
            if (operator === 'isEmpty') {
                return values.length === 0;
            }
            if (operator === 'isNotEmpty') {
                return values.length > 0;
            }

            // Если значений нет — остальные операторы не срабатывают
            if (values.length === 0) return false;

            const target = condition.value;

            switch (operator) {
                case 'equals':
                    return values.some(v => this.compareEqual(v, target));
                
                case 'notEquals':
                    return values.every(v => !this.compareEqual(v, target));
                
                case 'greater':
                    return values.some(v => this.compareNumeric(v, target, (a, b) => a > b));
                
                case 'less':
                    return values.some(v => this.compareNumeric(v, target, (a, b) => a < b));
                
                case 'greaterOrEqual':
                    return values.some(v => this.compareNumeric(v, target, (a, b) => a >= b));
                
                case 'lessOrEqual':
                    return values.some(v => this.compareNumeric(v, target, (a, b) => a <= b));
                
                case 'between': {
                    const from = condition.value;
                    const to = condition.valueTo;
                    if (from === '' || to === '') return false;
                    return values.some(v => {
                        const num = Number(v);
                        const numFrom = Number(from);
                        const numTo = Number(to);
                        if (!isNaN(num) && !isNaN(numFrom) && !isNaN(numTo)) {
                            return num >= numFrom && num <= numTo;
                        }
                        return v >= String(from) && v <= String(to);
                    });
                }
                
                case 'inArray': {
                    const targets = String(target).split(',').map(s => s.trim()).filter(Boolean);
                    return values.some(v => targets.some(t => this.compareEqual(v, t)));
                }
                
                case 'notInArray': {
                    const targets = String(target).split(',').map(s => s.trim()).filter(Boolean);
                    return values.every(v => !targets.some(t => this.compareEqual(v, t)));
                }
                
                case 'startsWith':
                    return values.some(v => String(v).startsWith(String(target)));
                
                case 'endsWith':
                    return values.some(v => String(v).endsWith(String(target)));
                
                case 'contains':
                    return values.some(v => String(v).includes(String(target)));
                
                default:
                    return false;
            }
        },

        // Умное сравнение на равенство (числа как числа, строки как строки)
        compareEqual(a, b) {
            const strA = String(a).trim();
            const strB = String(b).trim();
            if (strA === strB) return true;
            
            const numA = Number(a);
            const numB = Number(b);
            if (!isNaN(numA) && !isNaN(numB) && strA !== '' && strB !== '') {
                return numA === numB;
            }
            return false;
        },

        // Числовое сравнение с fallback на строковое
        compareNumeric(a, b, comparator) {
            const numA = Number(a);
            const numB = Number(b);
            if (!isNaN(numA) && !isNaN(numB) && String(a).trim() !== '' && String(b).trim() !== '') {
                return comparator(numA, numB);
            }
            // Fallback: строковое сравнение
            return comparator(String(a), String(b));
        },

        // Проверка группы условий (с учётом логики AND/OR)
        evaluateConditionGroup(group) {
            if (!group.conditions || group.conditions.length === 0) return true;
            if (group.logic === 'AND') {
                return group.conditions.every(c => this.evaluateCondition(c));
            }
            return group.conditions.some(c => this.evaluateCondition(c));
        },

        // Показывать ли поле (с учётом всех групп условий)
        shouldShow(item) {
            if (!this.config || !this.config.conditions) return true;

            const groups = this.config.conditions.filter(c => String(c.fieldId) === String(item.id));
            if (groups.length === 0) return true;

            const hideGroups = groups.filter(g => g.action === 'hide');
            const showGroups = groups.filter(g => g.action === 'show');

            // Если срабатывает хотя бы одна группа "скрывать" — прячем
            for (const g of hideGroups) {
                if (this.evaluateConditionGroup(g)) return false;
            }

            // Если есть группы "показывать" — показываем только если хотя бы одна сработала
            if (showGroups.length > 0) {
                return showGroups.some(g => this.evaluateConditionGroup(g));
            }

            return true;
        },

        // Работа с массивами (чекбоксы)
        toggleArrayValue(itemId, value) {
            const arr = this.formData[itemId];
            if (!Array.isArray(arr)) return;
            const idx = arr.indexOf(String(value));
            if (idx === -1) arr.push(String(value));
            else arr.splice(idx, 1);
        },

        isArrayValueSelected(itemId, value) {
            const arr = this.formData[itemId];
            return Array.isArray(arr) && arr.includes(String(value));
        },

        // Для arbitrary_input: работа с selected
        toggleArbitraryValue(itemId, value) {
            const obj = this.formData[itemId];
            if (!obj || !Array.isArray(obj.selected)) return;
            const idx = obj.selected.indexOf(String(value));
            if (idx === -1) obj.selected.push(String(value));
            else obj.selected.splice(idx, 1);
        },

        isArbitraryValueSelected(itemId, value) {
            const obj = this.formData[itemId];
            return obj && Array.isArray(obj.selected) && obj.selected.includes(String(value));
        },

        // Отправка формы
        submitForm() {
            const result = {
                submittedAt: new Date().toISOString(),
                fields: {}
            };

            this.config.formItems.forEach(item => {
                if (item.type !== 'field') return;
                const key = item.parameter + '_' + item.id;
                result.fields[key] = {
                    parameter: item.parameter,
                    parameterLabel: this.getParameterLabel(item.parameter),
                    type_form: item.type_form,
                    value: this.formData[item.id]
                };
            });

            console.log('[site.js] Отправленные данные формы:', result);
            alert('Форма отправлена. Данные в консоли (F12).');
        },

        // Обработчик выбора значения из массива
        onSelectFromArray(item, value) {
            const data = this.formData[item.id];
            if (!data) return;
            
            data.mode = 'array';
            data.custom = value;
        },

        // Обработчик ввода в поле произвольного значения
        onCustomInput(item) {
            const data = this.formData[item.id];
            if (!data) return;
            
            data.mode = 'custom';
            data.selected = '';
        },

        // Автокоррекция произвольного значения до ближайшего валидного
        correctCustomValue(item) {
            const data = this.formData[item.id];
            if (!data || data.custom === '' || data.custom === null || data.custom === undefined) {
                return;
            }

            const options = this.getFieldOptions(item);
            const numericValues = options
                .map(opt => Number(opt.value))
                .filter(num => !isNaN(num));

            // Если не все значения числовые, коррекцию не применяем
            if (numericValues.length === 0 || numericValues.length !== options.length) {
                return;
            }

            const customNum = Number(data.custom);
            if (isNaN(customNum)) {
                // Если не число, устанавливаем минимальное значение
                data.custom = Math.min(...numericValues);
                return;
            }

            const min = Math.min(...numericValues);
            const max = Math.max(...numericValues);

            // Корректируем до ближайшей границы
            if (customNum < min) {
                data.custom = min;
            } else if (customNum > max) {
                data.custom = max;
            }
        }
    };
}