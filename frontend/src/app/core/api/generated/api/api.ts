export * from './calculator.service';
import { CalculatorService } from './calculator.service';
export * from './calculator.serviceInterface';
export * from './jobs.service';
import { JobsService } from './jobs.service';
export * from './jobs.serviceInterface';
export const APIS = [CalculatorService, JobsService];
