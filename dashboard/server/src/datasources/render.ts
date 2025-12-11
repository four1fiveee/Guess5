import fetch from 'node-fetch';
import { config } from '../config';

export interface RenderHealth {
  status: 'healthy' | 'degraded' | 'down';
  responseTime?: number;
}

export async function checkRenderHealth(): Promise<RenderHealth> {
  const start = Date.now();
  try {
    const url = `${config.render.serviceUrl}${config.render.healthPath}`;
    const response = await fetch(url, {
      method: 'GET',
      timeout: 5000,
    } as any);
    const responseTime = Date.now() - start;
    
    if (response.ok) {
      return {
        status: 'healthy',
        responseTime,
      };
    } else {
      return {
        status: 'degraded',
        responseTime,
      };
    }
  } catch (error) {
    return {
      status: 'down',
    };
  }
}







