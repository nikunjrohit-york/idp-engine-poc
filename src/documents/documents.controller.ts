import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EngineRegistry } from '../engines/engine-registry';
import { FormRegistry } from '../forms/form-registry';
import { buildJsonSchema } from '../forms/json-schema.builder';
import { CompareService } from './compare.service';
import { DocumentsService } from './documents.service';
import { CompareQueryDto, UPLOAD_BODY_SCHEMA, UploadDocumentDto } from './dto';

@ApiTags('documents')
@Controller('v1/documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly compareService: CompareService,
  ) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Upload a document, run engines, and return each extraction with fields/groups/other/values (same shape as GET /v1/extractions/:id)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: UPLOAD_BODY_SCHEMA })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
  ) {
    if (!file?.buffer?.length)
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'multipart field "file" is required',
      });
    return this.documents.upload(file.buffer, dto.formType, dto.engines);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Document with all its extraction runs' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.getDocument(id);
  }

  @Get(':id/compare')
  @ApiOperation({ summary: 'Field-by-field comparison of the latest run per engine' })
  compare(@Param('id', ParseUUIDPipe) id: string, @Query() q: CompareQueryDto) {
    return this.compareService.compare(id, q.formType);
  }

  @Get(':id/pages/:n')
  @ApiOperation({ summary: 'Rasterized page PNG (for the review overlay)' })
  async page(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('n', ParseIntPipe) n: number,
  ): Promise<StreamableFile> {
    const png = await this.documents.getPage(id, n);
    return new StreamableFile(png, { type: 'image/png', disposition: 'inline' });
  }
}

@ApiTags('extractions')
@Controller('v1/extractions')
export class ExtractionsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'One extraction run with field values, confidence, bbox and review flags',
  })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.getExtraction(id);
  }
}

@ApiTags('catalog')
@Controller('v1')
export class CatalogController {
  constructor(
    private readonly engines: EngineRegistry,
    private readonly forms: FormRegistry,
  ) {}

  @Get('engines')
  @ApiOperation({ summary: 'Which engines exist and which are enabled by env' })
  listEngines() {
    return this.engines.describe();
  }

  @Get('forms')
  @ApiOperation({ summary: 'Registered form definitions' })
  listForms() {
    return this.forms.list().map((f) => ({
      id: f.id,
      version: f.version,
      title: f.title,
      generic: f.generic ?? false,
      fields: f.fields.length,
      groups: (f.groups ?? []).map((g) => ({
        path: g.path,
        maxRows: g.maxRows,
        columns: g.columns.length,
      })),
      cues: f.cues?.phrases.length ?? 0,
    }));
  }

  @Get('forms/:id')
  @ApiOperation({ summary: 'Form definition plus the JSON Schema sent to schema engines' })
  getForm(@Param('id') id: string) {
    const def = this.forms.get(id);
    return { ...def, jsonSchema: buildJsonSchema(def) };
  }
}
