/**
 * MediumEditor extension to enable media uploads through wp.media (Media Gallery), 
 * editing inserting images in content as well as gallery shortcodes and featured image
 */
function Wa_image_upload(this_options) {
    var self = this;
    self.editor_options        = this_options;
    self.get_image_src_timeout = false;
    self.handles               = false;
    self.resizing_img          = false;

    self.render_upload_toolbar();
}

/**
 * Adds and binds image upload toolbar
 */
Wa_image_upload.prototype.render_upload_toolbar = function() {
    var self = this,
        image_upload_toolbar           = document.createElement('div');
        image_upload_toolbar.className = 'medium-wa-image-upload-toolbar';
        image_upload_toolbar.buttons   = [
            {
                'id'    : 'add-image',
                'icon'  : 'fa fa-picture-o',
                'title' : wa_fronted.i18n('Add media'),
                'func'  : function(){
                    self.onClick();
                }
            }
        ];

    image_upload_toolbar.buttons = wa_fronted.apply_filters('image_upload_toolbar', image_upload_toolbar.buttons, self.editor_options);

    for(var i = 0; i < image_upload_toolbar.buttons.length; i++){
        var button      = image_upload_toolbar.buttons[i],
            button_el   = document.createElement('button'),
            button_icon = document.createElement('i');
            
            button_el.className   = 'wa-image-upload-' + button.id;
            button_icon.className = button.icon;
            button_icon.title     = button.title;

        button_el.appendChild(button_icon);
        image_upload_toolbar.appendChild(button_el);

        button_el.addEventListener('click', button.func);
    }

    document.body.appendChild(image_upload_toolbar);
    self.image_upload_toolbar = jQuery(image_upload_toolbar);
}

/**
 * Creates wp.media instance based on type
 * @param  {string} type image|gallery determines type of wp.media instance
 * @param  {string} shortcode_string [optional] a valid WordPress shortcode
 * @param  {jQuery Object} shortcode_wrap [optional] jquery object of shortcode wrapper element
 */
Wa_image_upload.prototype.setup_wp_media = function(type, shortcode_string, shortcode_wrap) {
    shortcode_string = shortcode_string || false;
    shortcode_wrap   = shortcode_wrap || false;

    var self = this;

    //Destroy current frame, else return
    if(self.frame){
        if(self.frame.options.state !== type){
            self.frame.dispose();
        }else{
            return;
        }
    }

    if(type === 'insert'){
        self.frame = wp.media({
            frame    : 'post',
            editing  : true,
            multiple : false
        });   
    }else if(type === 'gallery-edit' && shortcode_string !== false){
        var selection = self.select(shortcode_string);
        if(selection !== false){
            self.frame = wp.media({
                frame     : 'post',
                state     : 'gallery-edit',
                title     : wp.media.view.l10n.editGalleryTitle,
                editing   : true,
                multiple  : true,
                selection : selection
            });
        }else{
            self.frame = wp.media({
                frame    : 'post',
                state    : 'gallery-edit',
                title    : wp.media.view.l10n.editGalleryTitle,
                editing  : true,
                multiple : true
            });
        }
    }else if(type === 'featured-image'){
        self.frame = wp.media({
            frame  : 'post',
            state  : 'featured-image',
            states : [ new wp.media.controller.FeaturedImage() , new wp.media.controller.EditImage() ],
            // editing: true,
            // multiple: false
        });   
    }

    self.frame.on( 'insert', function() {
        var selection = self.frame.state().get('selection');

        if(selection.length === 0){
            self.insertGallery(self.frame);
        }else{
            if(typeof self.replace_this !== 'undefined' && self.replace_this !== false){
                self.insertImage(self.frame, self.replace_this);
            }else{
                self.insertImage(self.frame);
            }
        }
    });

    self.frame.on( 'update', function() {
        self.insertGallery(self.frame, shortcode_wrap);
    });

    self.frame.state('featured-image').on( 'select', function() {
        var selection = self.frame.state().get('selection').single();
        if(typeof self.replace_this !== 'undefined' && self.replace_this !== false){
            self.insertImage(self.frame, self.replace_this);
        }else{
            self.insertImage(self.frame);
        }
    });
}

/**
 * Init extension
 */
Wa_image_upload.prototype.init = function() {
    this.setup_wp_media('insert');
    this.instance = this.base;
    this.bindings(this.instance, jQuery(this.instance.elements));
};

/**
 * Calculate aspect ratio
 * @param  {float} width
 * @param  {float} height
 * @return {float} aspect_ratio
 */
Wa_image_upload.prototype.aspect_ratio = function(width, height){
    return width / height;
}

/**
 * Proper rounding for decimals
 * @param  {float} value    value to round
 * @param  {int} decimals  number of decimals to return
 * @return {int}          result
 */
Wa_image_upload.prototype.round = function(value, decimals) {
    return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
}

/**
 * Loops through WordPress image sizes and finds closest match
 * @param  {int} height  current image height
 * @param  {int} width  current image width
 * @return {mixed}        object with closest match or false if none
 */
Wa_image_upload.prototype.get_closest_image_size = function(attachment_id, height, width, callback){

    var self       = this,
        height     = Math.round(height),
        width      = Math.round(width),
        image_type = false,
        closest    = {
            diff      : null,
            size_name : null,
            height    : null,
            width     : null,
            crop      : null
        },
        aspect_ratio = self.round(self.aspect_ratio(width, height), 2);

    for(size in global_vars.image_sizes){
        var this_size        = global_vars.image_sizes[size],
            size_height      = parseInt(this_size.height),
            size_width       = parseInt(this_size.width),
            new_aspect_ratio = self.round(self.aspect_ratio(size_width, size_height), 2),
            this_image_type  = false;

        if(aspect_ratio === new_aspect_ratio || (this_size.crop !== true && this_size.crop !== 1)){
            var height_diff = Math.abs(height - size_height);

            if(height_diff < closest.diff || closest.diff === null){
                closest.diff      = height_diff;
                closest.size_name = size;
                closest.height    = size_height;
                closest.width     = size_width;
                closest.crop      = this_size.crop;
            }
        }
    }

    if(closest.size_name !== null){
        jQuery.post(
            global_vars.ajax_url,
            {
                'action'        : 'wa_get_image_src',
                'attachment_id' : attachment_id,
                'size'          : closest.size_name
            }, 
            function(response){
                callback(response);
            }
        );
    }
}

/**
 * Registers bindings, unregisters if already exists
 * @param  {Object} instance instance of MediumEditor
 * @param  {jQuery Object} editor_container jQuery element of editor
 */
Wa_image_upload.prototype.bindings = function(instance, editor_container){
    var self = this;

    jQuery('body').click(function(e){
        jQuery(self.image_upload_toolbar).removeClass('show');
        if(self.image_toolbar !== undefined && e.target.classList[0] !== 'resize_handles'){
            self.image_toolbar.removeClass('show');
        }
    });

    //Init jquery ui resizable
    editor_container.on('resizecreate', function(event, ui){
        var image_classes = event.target.firstChild.className,
            alignment = image_classes.match(/([align]\S+)/)[1];
        
        jQuery(event.target)
            .css({
                'overflow' : 'visible',
                'margin'   : ''
            })
            .addClass(alignment);
    });

    self.enable_resizing(instance, editor_container);

    wa_fronted.add_action('shortcode_action_gallery', function(shortcode, element){
        self.setup_wp_media(
            'gallery-edit', 
            shortcode, 
            element
        );
        self.frame.open();
    });

    editor_container.click(function(e){
        if(wa_fronted.getSelectionText() === '' && e.target.tagName !== 'IMG'){
            self.setup_wp_media('insert');
            
            clearTimeout(showTimer);
            var showTimer = setTimeout(function(){
                self.showToolbar(e, editor_container);
            }, instance.options.delay);

        }else if(e.target.tagName === 'IMG' && e.target.className.match(/wp-image-\d+/) === null){
            self.setup_wp_media('featured-image');
            wa_fronted.show_loading_spinner();
            jQuery.post(
                global_vars.ajax_url,
                {
                    'action'  : 'wa_get_thumbnail_id',
                    'post_id' : self.editor_options.post_id
                }, 
                function(response){
                    if(response.attachment_id !== '' && response.attachment_id !== false){
                        wp.media.view.settings.post.featuredImageId = parseInt(response.attachment_id);
                        self.WPMedia(parseInt(response.attachment_id));
                    }
                    wa_fronted.hide_loading_spinner();
                }
            );
        }
    });

    self.enable_drop_upload(instance, editor_container);
};

Wa_image_upload.prototype.enable_drop_upload = function(instance, editor_container) {
    
    if(Modernizr.filereader){
        var self = this,
            allowed_file_types = [
                'image/jpeg',
                'image/png',
                'image/gif'
            ];

        
        instance.subscribe('editableDrop', function (event, editable) {
            if(!self.is_dragging){
                event.preventDefault();
                event.stopPropagation();

                if(event.dataTransfer.files.length !== 0){
                    wa_fronted.show_loading_spinner();
                    var file = event.dataTransfer.files[0];

                    if(jQuery.inArray(file.type, allowed_file_types) !== -1){
                        var fileReader = new FileReader();

                        fileReader.onload = function(evt){
                            jQuery.post(
                                global_vars.ajax_url,
                                {
                                    'action'                : 'wa_create_image',
                                    'post_id'               : self.editor_options.post_id,
                                    'file_data'             : encodeURIComponent(evt.target.result),
                                    'file_name'             : file.name,
                                    'file_type'             : file.type,
                                    'wa_fronted_save_nonce' : global_vars.nonce
                                }, 
                                function(response){
                                    self.dropImage(event.target, response.attachment_obj, false);
                                }
                            );
                        };

                        fileReader.readAsDataURL(file);
                    }else{
                        wa_fronted.show_loading_spinner();
                    }
                }
            }
        });
    }
}

/**
 * Make images resizable and change img src to the closest to new size
 * @param  {Object} instance instance of MediumEditor
 * @param  {jQuery Object} editor_container jQuery element of editor
 */
Wa_image_upload.prototype.enable_resizing = function(instance, editor_container) {
    var self = this,
        images = editor_container.find('img[class*="wp-image-"]');

    if(images.length > 0){
        if(self.handles === false){
            self.handles              = document.createElement('div');
            self.handles.className    = 'resize_handles';

            self.handles.se           = document.createElement('span');
            self.handles.se.className = 'resize_handle se fa fa-arrows-alt';
            self.handles.appendChild(self.handles.se);
        
            document.body.appendChild(self.handles);

            self.handles = jQuery(self.handles);
            self.on_resize_image();
            self.enable_image_toolbar(instance, editor_container);
            self.on_image_drag(instance, editor_container);
        }

        for(var i = 0; i < images.length; i++){
            var this_image = jQuery(images[i]);
            if(this_image.data('resizable') !== true){
                this_image.data('resizable', true);
                this_image.on('hover', function( event ){
                    var hovering_img = jQuery(this);
                    self.resizing_img = hovering_img;

                    var caption_container = self.resizing_img.parents('.wp-caption');
                    if(caption_container.length !== 0){
                        self.resizing_img.caption = caption_container;
                    }
                    
                    self.position_handles(hovering_img);
                });
            }
        }

    }
}

/**
 * Positions resizing handles based on container and sets necessary values
 */
Wa_image_upload.prototype.position_handles = function(container) {

    var self = this,
        offset = container.offset(),
        handle = self.handles.find('.resize_handle');

    self.handles.css({
        'width'  : container.width() + 10,
        'height' : container.height() + 10,
        'top'    : offset.top - 5,
        'left'   : offset.left - 5
    });

    self.handles.addClass('show');

    self.handles.off();
    
    self.handles.on('mouseout blur', function(){
        self.handles.removeClass('show');
    });

    self.handles.on('click', function(e){
        if(e.target.classList[0] !== 'resize_handle'){
            self.show_image_edit_toolbar(e);
        }
    });

    self.handles.on('mousedown', function(e){
        if(e.target.classList[0] !== 'resize_handle'){ 
            self.ghost     = document.createElement('img');
            self.ghost.src = self.resizing_img.attr('src');
            self.ghost.id  = 'wa-fronted-img-drag-ghost';

            document.body.appendChild(self.ghost);

            self.ghost               = jQuery(self.ghost);
            self.is_within_container = true,
            self.has_moved           = false
            self.is_dragging         = true;
            self.orig_mouse_pos      = {
                'y' : e.clientY,
                'x' : e.clientX
            };
        }
    });

    handle.off();
    handle.on('mousedown touchstart', function(event){
        self.current_size = {
            'height' : container.height(),
            'width'  : container.width(),
            'x'      : event.clientX,
            'y'      : event.clientY
        };

        event.preventDefault();
        self.is_resizing = true;
    }); 
}

/**
 * Binds and handles resizing function
 */
Wa_image_upload.prototype.on_resize_image = function() {
    var self = this;

    jQuery(document).on('mousemove touchmove mouseup touchend', function(event){
        if(self.is_resizing === true && (event.type === 'mousemove' || event.type === 'touchmove')){

            event.stopPropagation();
            event.preventDefault();

            var new_size = {
                    'width'   : self.current_size.width + (event.clientX - self.current_size.x),
                    'height'  : self.current_size.height + (event.clientY - self.current_size.y),
                    'offsetX' : (event.clientX - self.current_size.x),
                    'offsetY' : (event.clientY - self.current_size.y),
                },
                final_size = {
                    'height' : 0,
                    'width'  : 0
                };

            //Calculate size proportionally to keep aspect ratio
            if (Math.abs(new_size.offsetX) > Math.abs(new_size.offsetY)) {
                final_size.width = Math.round(self.current_size.width + new_size.offsetX);
                final_size.height = Math.round(final_size.width * (self.current_size.height / self.current_size.width));
            } else {
                final_size.height = Math.round(self.current_size.height + new_size.offsetY);
                final_size.width = Math.round(final_size.height * (self.current_size.width / self.current_size.height));
            }

            self.resizing_img
                .width(final_size.width)
                .height(final_size.height);

            if(self.resizing_img.hasOwnProperty('caption')){
                self.resizing_img.caption
                    .width(final_size.width)
                    .height(final_size.height);
            }


            self.handles.css({
                'width'  : final_size.width + 10,
                'height' : final_size.height + 10
            });

        }else if(self.is_resizing === true && (event.type === 'mouseup' || event.type === 'touchend')){

            event.preventDefault();
            self.is_resizing = false;

            //Ensure aspect ratio
            self.resizing_img.height((self.current_size.height / self.current_size.width) * self.resizing_img.width());

            //Set wp image size to closest matching
            clearTimeout(self.get_image_src_timeout);
            self.get_image_src_timeout = setTimeout(function(){
                var class_match = self.resizing_img[0].className.match(/wp-image-\d+/);
                if(class_match !== null){
                    var attachment_id = class_match[0].match(/\d+/)[0];
                    self.get_closest_image_size(attachment_id, self.resizing_img.height(), self.resizing_img.width(), function(response){
                        if(response[3] === true){
                            self.resizing_img[0].className = self.resizing_img[0].className.replace(/size-\S+/, 'size-' + response[4]);
                            self.resizing_img.attr('src', response[0]);
                        }
                    });
                }

                wa_fronted.trigger(self.instance, 'editableInput');
            }, 500);

        }
    });
}


Wa_image_upload.prototype.on_image_drag = function(instance, editor_container) {
    var self = this;

    editor_container.on('mouseout', function(){
        if(self.is_dragging){
            self.is_within_container = false;
        }
    });

    editor_container.on('mouseenter', function(){
        if(self.is_dragging){
            self.is_within_container = true;
        }
    });

    jQuery(document).on('mousemove touchmove mouseup touchend', function(event){
        if(self.is_dragging){
            event.stopPropagation();
            event.preventDefault();

            var range = self.getMouseEventCaretRange(event.originalEvent),
                sel = rangy.getSelection();
            
            sel.setSingleRange(range);

            if(event.type === 'mousemove' || event.type === 'touchmove'){

                if(!self.has_moved){
                    if(self.orig_mouse_pos.y < event.clientY - 2 || self.orig_mouse_pos.y > event.clientY + 2 || self.orig_mouse_pos.x < event.clientX - 2 || self.orig_mouse_pos.x > event.clientX + 2){
                        self.has_moved = true;
                        self.image_toolbar.removeClass('show');
                    }
                }
            
                if(self.has_moved){
                    self.ghost[0].style.top = event.clientY + 'px';
                    self.ghost[0].style.left = event.clientX + 'px';
                }

            }else if(event.type === 'mouseup' || event.type === 'touchend'){

                if(self.is_within_container && self.has_moved){

                    self.is_dragging = false;
                    // editor_container[0].focus();

                    self.ghost.remove();
                    self.ghost = false;

                    var range = self.getMouseEventCaretRange(event.originalEvent),
                        sel = rangy.getSelection();
                
                    sel.setSingleRange(range);
                    
                    // editor_container[0].focus();

                    var shortcode_wrapper = self.resizing_img.parents('.wa-shortcode-wrap'),
                        img_link = self.resizing_img.parent('a'),
                        html_to_insert = self.resizing_img[0].outerHTML;

                    if(shortcode_wrapper.length !== 0){
                        html_to_insert = shortcode_wrapper[0].outerHTML;
                        shortcode_wrapper.remove();
                    }else if(img_link.length !== 0){
                        html_to_insert = img_link[0].outerHTML;
                        img_link.remove();
                    }else{
                        self.resizing_img.remove();
                    }

                    self.resizing_img = false;
                    
                    wa_fronted.insertHtmlAtCaret(html_to_insert, sel, range);
                    self.enable_resizing(self.instance, jQuery(self.instance.elements));

                }else{

                    self.is_dragging = false;
                    self.ghost.remove();
                    self.ghost = false;
                    
                }

            }
        }
    });
}


/**
 * Adds and binds image editing toolbar
 * @param  {Object} instance         medium-editor instance
 * @param  {jQuery Object} editor_container current editor object
 */
Wa_image_upload.prototype.enable_image_toolbar = function(instance, editor_container) {
    var self = this,
        image_toolbar           = document.createElement('div');
        image_toolbar.className = 'medium-wa-image-edit-toolbar';
        image_toolbar.buttons   = [
            {
                'id' : 'alignleft',
                'icon' : 'dashicons dashicons-align-left',
                'title' : wa_fronted.i18n('Align left'),
                'func' : function(){
                    var img_el = self.resizing_img[0],
                        img_caption_wrap = self.resizing_img.parents('.wa-shortcode-wrap');

                    if(img_caption_wrap.length !== 0){
                        img_el = img_caption_wrap.find('.wp-caption')[0];
                        console.log(img_el);
                    }

                    img_el.className = img_el.className.replace(/align\w+/, 'alignleft');
                }
            },
            {
                'id' : 'aligncenter',
                'icon' : 'dashicons dashicons-align-center',
                'title' : wa_fronted.i18n('Align center'),
                'func' : function(){
                    var img_el = self.resizing_img[0],
                        img_caption_wrap = self.resizing_img.parents('.wa-shortcode-wrap');

                    if(img_caption_wrap.length !== 0){
                        img_el = img_caption_wrap.find('.wp-caption')[0];
                        console.log(img_el);
                    }

                    img_el.className = img_el.className.replace(/align\w+/, 'aligncenter');
                }
            },
            {
                'id' : 'alignright',
                'icon' : 'dashicons dashicons-align-right',
                'title' : wa_fronted.i18n('Align right'),
                'func' : function(){
                    var img_el = self.resizing_img[0],
                        img_caption_wrap = self.resizing_img.parents('.wa-shortcode-wrap');

                    if(img_caption_wrap.length !== 0){
                        img_el = img_caption_wrap.find('.wp-caption')[0];
                        console.log(img_el);
                    }

                    img_el.className = img_el.className.replace(/align\w+/, 'alignright');
                }
            },
            {
                'id' : 'edit',
                'icon' : 'dashicons dashicons-edit',
                'title' : wa_fronted.i18n('Edit'),
                'func' : function(){

                    var img_link = self.resizing_img.parents('a'),
                        img_wrap = self.resizing_img,
                        img_caption_wrap = self.resizing_img.parents('.wa-shortcode-wrap');

                    if(img_caption_wrap.length !== 0){
                        img_wrap = img_caption_wrap;
                    }else if(img_link.length !== 0){
                        img_wrap = img_link;
                    }

                    self.replace_this = img_wrap;

                    var class_match = self.resizing_img[0].className.match(/wp-image-\d+/);
                    if(class_match !== null){
                        self.setup_wp_media('insert');
                        self.WPMedia(parseInt(class_match[0].match(/\d+/)[0]));
                    }
                
                }
            },
            {
                'id' : 'remove',
                'icon' : 'dashicons dashicons-no',
                'title' : wa_fronted.i18n('Remove'),
                'func' : function(){

                    var img_link = self.resizing_img.parents('a'),
                        img_wrap = self.resizing_img,
                        img_caption_wrap = self.resizing_img.parents('.wa-shortcode-wrap');

                    if(img_caption_wrap.length !== 0){
                        img_wrap = img_caption_wrap;
                    }else if(img_link.length !== 0){
                        img_wrap = img_link;
                    }

                    wa_fronted.replace_html(img_wrap, '');

                }
            }
        ];

    image_toolbar.buttons = wa_fronted.apply_filters('image_edit_toolbar', image_toolbar.buttons, self.editor_options);

    for(var i = 0; i < image_toolbar.buttons.length; i++){
        var button      = image_toolbar.buttons[i],
            button_el   = document.createElement('button'),
            button_icon = document.createElement('i');
            
            button_el.className   = 'wa-image-edit-' + button.id;
            button_icon.className = button.icon;
            button_icon.title     = button.title;

        button_el.appendChild(button_icon);
        image_toolbar.appendChild(button_el);

        button_el.addEventListener('click', button.func);
    }

    document.body.appendChild(image_toolbar);
    self.image_toolbar = jQuery(image_toolbar);
}

Wa_image_upload.prototype.show_image_edit_toolbar = function(event) {

    var self   = this,
        offset = self.resizing_img.offset(),
        scroll_top = jQuery(window).scrollTop(),
        distance_to_top = offset.top - scroll_top,
        pos_top = offset.top;
        
        self.image_toolbar.removeClass('arrow-over arrow-under');

        if(distance_to_top <= 42){
            pos_top = offset.top + self.resizing_img.height() + 42;
            self.image_toolbar.addClass('arrow-over');
        }else{
            self.image_toolbar.addClass('arrow-under');
        }

        self.image_toolbar
            .css({
                'top' : pos_top,
                'left' : (offset.left + ((self.resizing_img.width() / 2) - (self.image_toolbar.width() / 2)))
            })
            .addClass('show');
}

/**
 * Gets initial gallery-edit images. Function modified from wp.media.gallery.edit
 * @param {string} shortcode_string
 * @return {Object} wp.media selection
 */
Wa_image_upload.prototype.select = function(shortcode_string) {
    var shortcode = wp.shortcode.next('gallery', shortcode_string),
        defaultPostId = wp.media.gallery.defaults.id,
        attachments, selection;
 
    // Bail if we didn't match the shortcode or all of the content.
    if ( ! shortcode )
        return false;
 
    // Ignore the rest of the match object.
    shortcode = shortcode.shortcode;
 
    if ( _.isUndefined( shortcode.get('id') ) && ! _.isUndefined( defaultPostId ) )
        shortcode.set( 'id', defaultPostId );
 
    attachments = wp.media.gallery.attachments( shortcode );
    selection = new wp.media.model.Selection( attachments.models, {
        props:    attachments.props.toJSON(),
        multiple: true
    });
     
    selection.gallery = attachments.gallery;
 
    // Fetch the query's attachments, and then break ties from the
    // query to allow for sorting.
    selection.more().done( function() {
        // Break ties with the query.
        selection.props.set({ query: false });
        selection.unmirror();
        selection.props.unset('orderby');
    });
 
    return selection;
}

/**
 * Show image upload button (toolbar)
 * @param  {Object} event object
 * @param  {jQuery Object} this editor
 */
Wa_image_upload.prototype.showToolbar = function(event, editor_container) {
	var self = this;
    self.positionImageToolbar(event);
	jQuery(self.image_upload_toolbar).addClass('show');
    jQuery(window).scroll(function(){
        self.positionImageToolbar(event);
    });
};

/**
 * Bind what happens when user clicks button in toolbar
 */
Wa_image_upload.prototype.onClick = function() {
    this.WPMedia();
};

/**
 * Insert gallery into content
 * @param  {Object} wp.media frame
 * @param  {jQuery Object} shortcode_wrap [optional] wrapping element
 */
Wa_image_upload.prototype.insertGallery = function(frame, shortcode_wrap){
    shortcode_wrap = shortcode_wrap || false;

    var gallery_controller = frame.states.get('gallery-edit');
        library = gallery_controller.get('library'),
        self = this;

    if(library.length !== 0){
        var shortcode = wp.media.gallery.shortcode(library).string();

        wa_fronted.shortcode_to_html(
            shortcode, 
            ((shortcode_wrap === false) ? true : false), 
            function(response){
                if(shortcode_wrap !== false){
                    wa_fronted.replace_html(shortcode_wrap, response);
                }else{
                    wa_fronted.insertHtmlAtCaret(response);
                }

                wa_fronted.trigger(self.instance, 'editableInput');
                wa_fronted.bind_shortcode_edit(self.instance.elements[0]);
            }
        );
    }
};

/**
 * Insert image into content
 * @param  {Object} wp.media frame
 */
Wa_image_upload.prototype.insertImage = function(frame, replace_this){
    var self         = this,
        state        = frame.state(),
        selection    = state.get('selection'),
        replace_this = replace_this || false;

    if ( ! selection ) return;
    selection.each(function(attachment) {
        var display = state.display( attachment ).toJSON(),
            obj_attachment = attachment.toJSON(),
            caption = obj_attachment.caption, 
            options, 
            html;

        // If captions are disabled, clear the caption.
        if ( ! wp.media.view.settings.captions )
            delete obj_attachment.caption;

        display = wp.media.string.props( display, obj_attachment );

        options = {
            id           : obj_attachment.id,
            post_content : obj_attachment.description,
            post_excerpt : caption
        };

        if(state.id !== 'featured-image') {

            if ( display.linkUrl )
                options.url = display.linkUrl;

            if ( 'image' === obj_attachment.type ) {
                display.url = display.src;

                html = wp.media.string.image( display );

                _.each({
                    align : 'align',
                    size  : 'image-size',
                    alt   : 'image_alt'
                }, function( option, prop ) {
                    if ( display[ prop ] )
                        options[ option ] = display[ prop ];
                });
            } else if ( 'video' === obj_attachment.type ) {
                html = wp.media.string.video( display, obj_attachment );
            } else if ( 'audio' === obj_attachment.type ) {
                html = wp.media.string.audio( display, obj_attachment );
            } else {
                html = wp.media.string.link( display );
                options.post_title = display.title;
            }

            //attach info to attachment.attributes object
            attachment.attributes['nonce']      = wp.media.view.settings.nonce.sendToEditor;
            attachment.attributes['attachment'] = options;
            attachment.attributes['html']       = html;
            attachment.attributes['post_id']    = wp.media.view.settings.post.id;

            if(replace_this !== false){
                if( wp.media.view.settings.captions && caption ){
                    wa_fronted.shortcode_to_html(attachment.attributes['html'], true, function(html){
                        wa_fronted.replace_html(replace_this, html);
                        self.replace_this = false;
                        self.enable_resizing(self.instance, jQuery(self.instance.elements));
                    });
                }else{
                    wa_fronted.replace_html(replace_this, attachment.attributes['html']);
                    self.replace_this = false;
                }
            }else{
                if( wp.media.view.settings.captions && caption ){
                    wa_fronted.shortcode_to_html(attachment.attributes['html'], true, function(html){
                        wa_fronted.insertHtmlAtCaret(html);
                        self.enable_resizing(self.instance, jQuery(self.instance.elements));
                    });
                }else{
                    wa_fronted.insertHtmlAtCaret(attachment.attributes['html']);
                }
            }

            wa_fronted.trigger(self.instance, 'editableInput');
            self.enable_resizing(self.instance, jQuery(self.instance.elements));

        } else {

            wa_fronted.show_loading_spinner();
            jQuery.post(
                global_vars.ajax_url,
                {
                    'action'        : 'wa_set_thumbnail',
                    'attachment_id' : options.id,
                    'image_size'    : self.editor_options.image_size,
                    'post_id'       : self.editor_options.post_id
                }, 
                function(response){
                    if(response.hasOwnProperty('html')){
                        if(replace_this !== false){
                            wa_fronted.replace_html(replace_this, response.html);
                            self.replace_this = false;   
                        }
                    }
                    wa_fronted.hide_loading_spinner();
                }
            );

        }
    });                
};

/**
 * Inserts image into content after being dropped
 * @param  {Object} attachment
 */
Wa_image_upload.prototype.dropImage = function(target, attachment, replace_this){
    replace_this = replace_this || false;

    var self = this,
        use_size = attachment.sizes.medium,
        html = '<img src="' + use_size.url + '" width="' + use_size.width + '" height="' + use_size.height + '" alt="' + attachment.title + '" class="wp-image-' + attachment.id + ' alignleft size-medium" style="height:' + use_size.height + '; width:' + use_size.width + ';">';

    if(replace_this !== false){
        wa_fronted.replace_html(replace_this, html);
        self.replace_this = false;
    }else{
        jQuery(target).append(html);
        wa_fronted.hide_loading_spinner();
    }

    setTimeout(function(){
        wa_fronted.trigger(self.instance, 'editableInput');
        self.enable_resizing(self.instance, jQuery(self.instance.elements));
    }, 500);
};

/**
 * Show wp.media instance
 * @param {int} attachment_id [optional]
 */
Wa_image_upload.prototype.WPMedia = function(attachment_id) {
    attachment_id = attachment_id || false;

    var frame = this.frame,
        self  = this;
    
        frame.once( 'open', function() {
            var selection = frame.state().get('selection');
            
            if(attachment_id !== false){
                attachment = wp.media.attachment(attachment_id);
                attachment.fetch();
                selection.add(attachment);
            }else{
                selection.reset();
            }
        });

    frame.open();
};

/**
 * Return button parameters for MediumEdtior toolbar
 * @return {Object} button
 */
Wa_image_upload.prototype.getButton = function() {
    return this.button;
};

/**
 * Position the image button (toolbar) in the editor
 * @param  {Object} event
 */
Wa_image_upload.prototype.positionImageToolbar = function(e) {

    var self = this;

    self.image_upload_toolbar[0].style.left = '0';

    var windowWidth     = self.base.options.contentWindow.innerWidth,
        toolbarWidth    = self.image_upload_toolbar[0].offsetWidth,
        halfOffsetWidth = toolbarWidth / 2,
        buttonHeight    = 50,
        defaultLeft     = halfOffsetWidth,
        caretPos        = wa_fronted.getCaretPositionPx();

	if (caretPos.y < buttonHeight) {
        self.image_upload_toolbar[0].classList.add('medium-toolbar-arrow-over');
        self.image_upload_toolbar[0].classList.remove('medium-toolbar-arrow-under');
        self.image_upload_toolbar[0].style.top = caretPos.y + (buttonHeight - 5) + 'px';
    } else {
        self.image_upload_toolbar[0].classList.add('medium-toolbar-arrow-under');
        self.image_upload_toolbar[0].classList.remove('medium-toolbar-arrow-over');
        self.image_upload_toolbar[0].style.top = caretPos.y - (buttonHeight - 5) + 'px';
    }

    if (caretPos.x < halfOffsetWidth) {
        self.image_upload_toolbar[0].style.left = defaultLeft + halfOffsetWidth + 'px';
    } else if ((windowWidth - caretPos.x) < halfOffsetWidth) {
        self.image_upload_toolbar[0].style.left = windowWidth + defaultLeft - halfOffsetWidth + 'px';
    } else {
        self.image_upload_toolbar[0].style.left = caretPos.x - halfOffsetWidth + 'px';
    }

};

Wa_image_upload.prototype.getMouseEventCaretRange = function(evt) {
    var range, x = evt.clientX, y = evt.clientY;
    
    // Try the simple IE way first
    if (document.body.createTextRange) {
        range = document.body.createTextRange();
        range.moveToPoint(x, y);
    } else if (typeof document.createRange != "undefined") {
        // Try Mozilla's rangeOffset and rangeParent properties, which are exactly what we want
        
        if (typeof evt.rangeParent != "undefined") {
            range = document.createRange();
            range.setStart(evt.rangeParent, evt.rangeOffset);
            range.collapse(true);
        }
    
        // Try the standards-based way next
        else if (document.caretPositionFromPoint) {
            var pos = document.caretPositionFromPoint(x, y);
            range = document.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
        }
    
        // Next, the WebKit way
        else if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(x, y);
        }
    }
    
    return range;
};