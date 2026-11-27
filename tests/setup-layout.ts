// Tests read LAYOUT directly; the app publishes it from src/boot.ts, the tests from here.
import { CITY, generateLayout, setLayout } from '../src/city/layout';

setLayout(generateLayout(CITY.seed));
