import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.json');

// Initial schema default collections
const defaultDB = {
  users: [],
  student_profiles: [],
  companies: [],
  internships: [],
  applications: [],
  saved_internships: [],
  resumes: []
};

class DB {
  constructor() {
    this.data = { ...defaultDB };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const fileData = fs.readFileSync(DB_FILE, 'utf8');
        this.data = { ...defaultDB, ...JSON.parse(fileData) };
      } else {
        this.save();
      }
    } catch (error) {
      console.error('Error loading database file, initializing default:', error.message);
      this.data = { ...defaultDB };
      this.save();
    }
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error('Error saving database file:', error.message);
    }
  }

  // Generic Query Helpers
  getCollection(name) {
    if (!this.data[name]) {
      this.data[name] = [];
    }
    return this.data[name];
  }

  find(collection, filterFn) {
    return this.getCollection(collection).filter(filterFn);
  }

  findOne(collection, filterFn) {
    return this.getCollection(collection).find(filterFn) || null;
  }

  insert(collection, item) {
    const coll = this.getCollection(collection);
    const newItem = {
      id: item.id || `${collection.slice(0, 3)}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: item.createdAt || new Date().toISOString(),
      ...item
    };
    coll.push(newItem);
    this.save();
    return newItem;
  }

  update(collection, filterFn, updateData) {
    const coll = this.getCollection(collection);
    let updated = null;
    this.data[collection] = coll.map(item => {
      if (filterFn(item)) {
        updated = { ...item, ...updateData, updatedAt: new Date().toISOString() };
        return updated;
      }
      return item;
    });
    if (updated) this.save();
    return updated;
  }

  delete(collection, filterFn) {
    const coll = this.getCollection(collection);
    const initialLen = coll.length;
    this.data[collection] = coll.filter(item => !filterFn(item));
    const deletedCount = initialLen - this.data[collection].length;
    if (deletedCount > 0) this.save();
    return deletedCount;
  }

  reset(newData = null) {
    this.data = newData ? { ...defaultDB, ...newData } : { ...defaultDB };
    this.save();
  }
}

export const db = new DB();
export default db;
